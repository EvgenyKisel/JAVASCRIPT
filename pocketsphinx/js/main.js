
var recognizer, recorder, callbackManager, audioContext, outputContainer;
// Only when both recorder and recognizer do we have a ready application
var isRecorderReady = isRecognizerReady = false;

// Функция удобства для публикации сообщения в распознаватель и связывания обратного вызова с его ответом
function postRecognizerJob(message, callback) {
    var msg = message || {};
    if (callbackManager) msg.callbackId = callbackManager.add(callback);
    if (recognizer) recognizer.postMessage(msg);
};

// Эта функция инициализирует экземпляр рекордера,
// он сразу же отправляет сообщение и вызывает onReady,
// когда он готов, чтобы можно было правильно установить onmessage
function spawnWorker(workerURL, onReady) {
    recognizer = new Worker(workerURL);
    recognizer.onmessage = function (event) {
        onReady(recognizer);
    };
    recognizer.postMessage('');
};

//Выводит предположения
function updateHyp(hyp) {
    if (outputContainer) outputContainer.innerHTML = hyp;
};

// обновляет пользовательский интерфейс
// Only when both recorder and recognizer are ready do we enable the buttons
function updateUI() {
    if (isRecorderReady && isRecognizerReady) startBtn.disabled = stopBtn.disabled = false;
};

//выводит статус процесса
function updateStatus(newStatus) {
    document.getElementById('current-status').innerHTML += "<br/>" + newStatus;
};

// recording indicator
function displayRecording(display) {
    if (display) document.getElementById('recording-indicator').innerHTML = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
    else document.getElementById('recording-indicator').innerHTML = "";
};

// Callback как только пользователь разрешит доступ к микрофону:
// in it, we instanciate the recorder
function startUserMedia(stream) {
    var input = audioContext.createMediaStreamSource(stream);
    //input(source) — это источник звука, наше пойманное аудио с микрофона.
    // Необходимо лишь преобразовать поток MediaStream в элемент,
    // с которым мы сможем работать, и для этого
    // подойдет метод аудио контекста createMediaStreamSource

    //добавление параметра в AudioRecorder, но можно и не делать, как понял
    var audioRecorderConfig = {
        errorCallback: function (x) {
            updateStatus("Error from recorder: " + x);
        }
    };
    recorder = new AudioRecorder(input, audioRecorderConfig);
    //Если распознаватель готов, мы передаем его на рекордер
    if (recognizer) recorder.consumers = [recognizer];
    isRecorderReady = true;
    updateUI();
    updateStatus("Audio recorder ready");
};

// Включает запись. для начала должны взять id of the grammar to use
var startRecording = function () {
   // var id = document.getElementById('grammars').value; // если добавлен выбор анализируемых слов
    if (recorder && recorder.start(0)) displayRecording(true); //if (recorder && recorder.start(id)) displayRecording(true);
};

// Останавливает запись
var stopRecording = function () {
    recorder && recorder.stop();
    displayRecording(false);
};

// вызывается когда recognizer готов
var recognizerReady = function () {
    //updateGrammars(); // если добавлен выбор анализируемых слов
    isRecognizerReady = true;
    updateUI();
    updateStatus("Recognizer ready");
};

// если добавлять выбор анализируемых слов
var updateGrammars = function () {
    var selectTag = document.getElementById('grammars');
    for (var i = 0; i < grammarIds.length; i++) {
        var newElt = document.createElement('option');
        newElt.value = grammarIds[i].id;
        newElt.innerHTML = grammarIds[i].title;
        selectTag.appendChild(newElt);
    }
};

// Добавляем grammar из grammars array
// мы добавляем их один за одним and call it again as a callback.
// когда добавим всю грамматику, вызываем recognizerReady()
var feedGrammar = function (g, index, id) {
    //if (id && (grammarIds.length > 0)) grammarIds[0].id = id.id; // если добавлен выбор анализируемых слов
    if (index < g.length) {
       // grammarIds.unshift({title: g[index].title}); // если добавлен выбор анализируемых слов
        postRecognizerJob({command: 'addGrammar', data: g[index].g},
            function (id) {
                feedGrammar(grammars, index + 1, {id: id});
            });
    } else {
       // grammarIds.push({"id": 0, "title": "Keyword spotting"}); // если добавлен выбор анализируемых слов
        recognizerReady();
    }
};

// добавлем слова в recognizer. когда calls back, добавляем грамматику
var feedWords = function (words) {
    postRecognizerJob({command: 'addWords', data: words},
        function () {
            feedGrammar(grammars, 0);
        });
};


// Когда страница загружается, создаем новый recognizer worker и вызываем getUserMedia, чтобы запросить доступ к микрофону
window.onload = function () {
    outputContainer = document.getElementById("output");
    updateStatus("Initializing web audio and speech recognizer, waiting for approval to access the microphone");
    callbackManager = new CallbackManager();
    spawnWorker("js/recognizer.js", function (worker) {
        worker.onmessage = function (e) {
            // случай, когда у нас есть callback id, который будет вызываться
            if (e.data.hasOwnProperty('id')) {
                var clb = callbackManager.get(e.data['id']);
                var data = {};
                if (e.data.hasOwnProperty('data')) data = e.data.data;
                if (clb) clb(data);
            }
            // на случай, если у распознавателя есть новая гипотеза
            if (e.data.hasOwnProperty('hyp')) {
                var newHyp = e.data.hyp;
                if (e.data.hasOwnProperty('final') && e.data.final) newHyp = "Final: " + newHyp;
                updateHyp(newHyp);
            }
            // на случай ошибки
            if (e.data.hasOwnProperty('status') && (e.data.status == "error")) {
                updateStatus("Error in " + e.data.command + " with code " + e.data.code);
            }
        };
        // Инициализация recognizer. когда calls back, добавляются слова
        postRecognizerJob({command: 'initialize'},
            function () {
                if (recorder) recorder.consumers = [recognizer];
                feedWords(wordList);
            });
    });

    // Инициализация Web Audio
    try {
        //метод в разных браузерах различен, поэтому будет не лишним
        // перед вызовом getUserMedia провернуть следующую штуку,
        // и обеспечить поддержку метода во всех распространенных
        // браузерах:
        navigator.getUserMedia = navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia;
        //В случае успеха выполнения метода getUserMedia,
        // мы получаем объект типа MediaStream, который уже можно
        // использовать для создания источника аудио с помощью
        // Web Audio API. Но чтобы воспользоваться этим способом,
        // для начала нужно создать AudioContext — наш проводник в мир Web Audio API

        //но и нужно не забывать про кроссбраузерность:
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        window.URL = window.URL || window.webkitURL;
        //создание экземпляра
        audioContext = new AudioContext();
    } catch (e) {
        updateStatus("Error initializing Web Audio browser");
    }
    // вызов getUserMedia
    if (navigator.getUserMedia) navigator.getUserMedia({audio: true}, startUserMedia, function (e) {
        updateStatus("No live audio input in this browser");
    });
    else updateStatus("No web audio support in this browser");

    // Wiring JavaScript to the UI
    var startBtn = document.getElementById('startBtn');
    var stopBtn = document.getElementById('stopBtn');
    startBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.onclick = startRecording;
    stopBtn.onclick = stopRecording;
};


// This is the list of words that need to be added to the recognizer
// This follows the CMU dictionary format
var wordList = [["MILLION", "M IH L Y AH N"], ["THOUSAND", "TH AW Z AH N D"], ["ONE-HUNDRED", "W AH N HH AH N D R AH D"], ["TEN", "T EH N"], ["FIFTY", "F IH F T IY"], ["BILLION", "B IH L Y AH N"],  ["ZERO", "Z IH R OW"]];
// This grammar recognizes digits
var grammars = [{g: {numStates: 1, start: 0, end: 0, transitions: [{from: 0, to: 0, word: "MILLION"}, {from: 0, to: 0, word: "THOUSAND"}, {from: 0, to: 0, word: "ONE-HUNDRED"}, {from: 0, to: 0, word: "TEN"}, {from: 0, to: 0, word: "FIFTY"}, {from: 0, to: 0, word: "BILLION"}, {from: 0, to: 0, word: "ZERO"}]}}];
// This grammar recognizes a few cities names
//var grammarCities = {numStates: 1, start: 0, end: 0, transitions: [{from: 0, to: 0, word: "NEW-YORK"}, {from: 0, to: 0, word: "NEW-YORK-CITY"}, {from: 0, to: 0, word: "PARIS"}, {from: 0, to: 0, word: "SHANGHAI"}, {from: 0, to: 0, word: "SAN-FRANCISCO"}, {from: 0, to: 0, word: "LONDON"}, {from: 0, to: 0, word: "BERLIN"}]};
//var grammars = [{title: "Digits", g: grammarDigits}, {title: "Cities", g: grammarCities}];
//var grammarIds = [];