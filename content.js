var awsIP;
var serverIP
var count;
var resizerY;
var originalText = "", subtitleData = [], timestampData = [];
var isHalfFull, isResizing = false, isDragging = false;
var openaiApiKey = "";
var video, moviePlayer, moviePlayerParent, ytpSizeBtn;
var offsety, startX, startLeft;
var curIdx;
var nowSubtitle, intervalNowSubtitle, intervalScroll;
let lastNowSubtitle = null;
var stopIntervalScroll;
var userTimeIntervalId = null;
var updateTimeIntervalId = null;
var dialogueData = [];

function startUserTime() {
  if (userTimeIntervalId) { return; }
  userTimeIntervalId = setInterval(async () => {
    if (document.visibilityState !== 'visible' || !layoutContainer || 
      layoutContainer.style.zIndex !== '10000' || !document.hasFocus()
    ) { return; }
    let storageData = await chrome.storage.local.get(["using_time"]);
    let using_time = storageData.using_time || 0; // 確保 `using_time` 存在
    let new_using_time = using_time + 1;
    await chrome.storage.local.set({ "using_time": new_using_time });      
    let updatedData = await chrome.storage.local.get(["using_time"]);
    console.log("localstorage -> using_time: ", updatedData.using_time);
  }, 1000);
}

intervalNowSubtitle = setInterval(() => {
  video = document.querySelector("video");
  if (!video) return;
  const curSec = video.currentTime;
  curIdx = timestampData.findIndex(({ start, end }) => (curSec >= start && curSec <= end));
  if (curIdx === -1) return;
  const nextSubtitle = subtitleContainer.children[curIdx];
  if (!nextSubtitle || (nextSubtitle && nextSubtitle.isEqualNode(nowSubtitle))) return; // 辨別內容而非指標
  nowSubtitle = nextSubtitle;
  nowSubtitle.classList.add("!bg-[#3f3f3f]");
  Array.from(subtitleContainer.children).forEach(child => {
    if (child === nowSubtitle) return;
    child.classList.remove("!bg-[#3f3f3f]");
  });
  if (!nowSubtitle) return;
  wrapper = nowSubtitle.querySelector(".JPsubtitle-subtitle-wrapper");
  cc.replaceChildren();
  if (!wrapper) return;
  cc.append(wrapper.cloneNode(true));
}, 100);

intervalScroll = setInterval(() => {
  if (!nowSubtitle || stopIntervalScroll || lastNowSubtitle === nowSubtitle) return;
  lastNowSubtitle = nowSubtitle;
  subtitleContainer.scrollTop = nowSubtitle.offsetTop - subtitleContainer.offsetTop - (subtitleContainer.clientHeight / 2) + (nowSubtitle.clientHeight / 2);
}, 100);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "sendData") {
    window[message.name] = message.data;
    sendResponse("OK");
  } 
  if (message.action === "urlChanged") {
    handle.clickResetBtn()
    sendResponse("OK");
  }
  if (message.action === "backMoviePlayer") {
    document.querySelector(".ytp-chrome-controls")?.querySelectorAll('svg').forEach(svg => {
      svg.style.setProperty("padding", "0");
    })
    document.querySelector("#country-code")?.style.setProperty("margin", "auto", "important");
    document.querySelector("#logo-icon")?.style.setProperty("padding", "0", "important");
  }
});

// 按鍵
const handle = {
  clickAutoScroll(e) {
    const autoScrollBtn = e.currentTarget;
    if (stopIntervalScroll) {
      autoScrollBtn.querySelector(".JPsubtitle-svg-icon").classList.remove("opacity-50");
      stopIntervalScroll = false;
    } else {
      autoScrollBtn.querySelector(".JPsubtitle-svg-icon").classList.add("opacity-50");
      stopIntervalScroll = true;
    }
  },
  clickCopyBtn(e) {
    const copyBtn = e.currentTarget;
    const index = Array.from(subtitleContainer.children).indexOf(copyBtn.parentElement.parentElement);
    const copyText = originalText.split('\n')[index];
    chatbotTyping.value = copyText;
    chatbotTyping.focus();
  },
  clickPlayBtn(e) {
    const playBtn = e.currentTarget;
    const subtitleDiv = playBtn.parentElement.parentElement;
    const subtitles = subtitleContainer.querySelectorAll('.JPsubtitle-subtitle');
    Array.from(subtitles).forEach(child => child.classList.remove("!bg-[#3f3f3f]"));
    subtitleDiv.classList.add("!bg-[#3f3f3f]");
    if (!video) return;
    const idx = Array.from(subtitles).indexOf(subtitleDiv);
    curIdx = idx;
    if (idx === -1) return;
    const { start, _ } = timestampData[idx];
    video.currentTime = start;
  },
  clickHiraOrRoma(e) {
    const textDiv = e.currentTarget.querySelector(".JPsubtitle-text")
    const spans = Array.from(document.querySelectorAll('.JPsubtitle-original-subtitle span'));    
    spans.forEach(span => { 
      span.querySelectorAll('.hira').forEach(hira => {(textDiv.innerText === "平假名") ? hira.classList.add('hidden') : hira.classList.remove('hidden')});    
      const roma = span.querySelector('.roma');
      (textDiv.innerText === "平假名") ? roma.classList.remove('hidden') : roma.classList.add('hidden');
    });
    textDiv.innerText = (textDiv.innerText === "平假名")? "羅馬\n拼音":"平假名"
  },
  clickChatbotResetBtn() {
    dialogueContainer.replaceChildren();
    dialogueData = [];
    var div = document.createElement("div")
    var textDiv = document.createElement("div")
    var pngDiv = document.createElement("div")
    textDiv.classList.add(..."text-3xl content-center !p-4 text-transparent !bg-clip-text !bg-gradient-to-r from-blue-400 via-purple-300 to-red-400".split(" "))
    textDiv.innerText = "問我任何有關歌曲的事！"
    pngDiv.classList.add(..."place-self-center place-content-center justify-center content-center w-60".split(" "))
    div.classList.add(..."place-self-center place-content-center justify-center content-center h-full".split(" "))
    putPng(pngDiv, "icons/chatbot.png")
    div.append(pngDiv, textDiv)
    dialogueContainer.append(div)
  },
  async clickChatbotSendBtn() {
    const inputText = chatbotTyping.value.trim();
    if (inputText === "") { return; }
    if (dialogueData.length === 0) {
      dialogueContainer.replaceChildren();
    }
    inputDialogueContainer(inputText)
    waitDialogueContainer()
    try {
      result = await callLLM("chat", inputText, dialogueData)
    } catch (error) {
      result = {"error": error, "statusCode": 500}
    }
    processingDialogueContainer(result)
  },
  startUpdatingUserTime() {
    updateTimeIntervalId = setInterval(() => { UserTimeToDatabase(); }, 1000 * 60);
  },
  pressEsc(e) { 
    if (e.key === 'Escape') handle.clickCloseBtn() 
  },
  clickResetBtn() {
    cc.replaceChildren();
    timestampData = [];
    subtitleData = [];
    originalText = "";
    translatedText = "";
    window.translatedText = "";
    subtitleContainer.replaceChildren()
    var div = document.createElement("div")
    div.classList.add(..."place-self-center text-3xl h-full content-center animate-pulse-custom text-gradient !bg-gradient-to-r from-blue-600 to-purple-300".split(" "))
    div.innerText = "目前沒有任何字幕"
    subtitleContainer.append(div)
  },
  clickCloseBtn() {
    hideContainers();
    // UserTimeToDatabase();
    // clearInterval(updateTimeIntervalId);
    // updateTimeIntervalId = null;
    document.removeEventListener('keydown', handle.pressEsc)
  },
  clickJaOrZhBtn(e) {
    const textDiv = e.currentTarget.querySelector(".JPsubtitle-text")
    const chs = document.querySelectorAll('.JPsubtitle-chinese-subtitle');
    const origs = document.querySelectorAll('.JPsubtitle-original-subtitle');

    if (textDiv.innerText === "中") {
      chs.forEach(ch => { ch.style.fontSize = "15px";  ch.style.color = "rgb(156, 156, 156)"; ch.parentElement.parentElement.classList.remove("hidden")})
      origs.forEach(orig => orig.style.display = "")
      textDiv.classList.remove("text-2xl")
      textDiv.classList.add("text-xl")
      textDiv.innerText = "日中"
    }
    else if (textDiv.innerText === "日中") {
      chs.forEach(ch => {
        ch.style.display = "none"; 
        if (!ch.parentElement.parentElement.classList.contains("!bg-[#3f3f3f]"))
          ch.parentElement.parentElement.classList.remove("!bg-[#3f3f3f]")
      })
      textDiv.classList.remove("text-xl")
      textDiv.classList.add("text-2xl")
      textDiv.innerText = "日"
    }
    else {
      chs.forEach(ch => { 
        ch.style.display = ""; ch.style.fontSize = "18px"; ch.style.color = "rgba(255, 255, 255, 0.71)"; 
        if (!ch.hasChildNodes()) ch.parentElement.parentElement.classList.add("hidden")
      })
      origs.forEach(orig => orig.style.display = "none")
      textDiv.innerText = "中"
    }
  },
  clickTranslateBtn() {
    if (subtitleData.length === 0) return
    subtitleContainer.replaceChildren()
    withLoader(subtitleContainer, async () => {
      try {
        result = await callLLM("translate", originalText, [])
        window.translatedText = (result.statusCode === 200) ? result.data : "翻譯失敗，請稍後再試"
      } catch (error) {
        window.translatedText = "翻譯錯誤，請再試一次"
        console.error(error);
      } finally {
        fillSubtitleContainer();
      }
    })
  },
  clickcc(e) {
    if (!cc.style.display || cc.style.display === 'none') {
      e.currentTarget.querySelector(".JPsubtitle-svg-icon").classList.remove("opacity-50")
      cc.style.display = 'block';
    } else {
      e.currentTarget.querySelector(".JPsubtitle-svg-icon").classList.add("opacity-50")
      cc.style.display = 'none';
    }
  },
  resizeMousemove(e) {
    if (!isResizing) return;
    subtitleContainer.style.userSelect = "none";
    const containerRect = subtitleCombineContainer.getBoundingClientRect();
    const fnDivRect = functionContainer.getBoundingClientRect();
    const minY = fnDivRect.height+100; 
    const maxY = containerRect.height-10; 
    resizerY = e.clientY - containerRect.top;
    if (resizerY < minY) {resizerY = minY}
    if (resizerY > maxY) {resizerY = maxY}
    handle.windowResize();
  },
  resizeMouseup() {
    isResizing = false;
    subtitleContainer.style.userSelect = "";
    subtitleContainer.classList.remove("no-select")
    chatbotContainer.classList.remove("no-select")
    document.removeEventListener('mousemove', handle.resizeMousemove);
    document.removeEventListener('mouseup', handle.resizeMouseup);
  },
  resizeMousedown() {
    isResizing = true;
    subtitleContainer.classList.add("no-select")
    chatbotContainer.classList.add("no-select")
    document.addEventListener('mousemove', handle.resizeMousemove);
    document.addEventListener('mouseup', handle.resizeMouseup);
  },
  windowResize() {
    const containerRect = subtitleCombineContainer.getBoundingClientRect();
    const fnDivRect = functionContainer.getBoundingClientRect();
    const chatbotfnContainerRect = chatbotfnContainer.getBoundingClientRect();
    let smallchange = resizer.getBoundingClientRect().height / 2;
    if (!resizerY) { resizerY = 450; }
    resizer.style.top = `${resizerY}px`;
    subtitleContainer.style.height = `${resizerY - fnDivRect.height + smallchange}px`;
    chatbotContainer.style.height = `${containerRect.height - resizerY - chatbotfnContainerRect.height - smallchange}px`;
  },
  ccMousemove(e) {
    if (!isDragging) { return; }
    cc.style.left = `${startLeft + (e.clientX - startX)}px`;
    cc.style.top = `${e.clientY - offsety}px`;
  },
  ccMouseup() {
    isDragging = false;
    cc.style.cursor = 'grab';
  },
  ccMousedown(e) {
    isDragging = true;
    cc.style.cursor = 'grabbing';
    startX = e.clientX;
    startLeft = cc.offsetLeft;
    offsety = e.clientY - cc.getBoundingClientRect().top;
  }
}

// 布局
const layoutContainer = getDiv('custom-layout', 'JPsubtitle-container', "fixed top-0 left-0 w-screen h-screen overflow-hidden hidden -z-10 !bg-[#0f0f0f]");
  const origMod = getDiv('', '', "w-full");
    const layoutFlexContainer = getDiv('layout-flex-container', 'JPsubtitle-layout-flex-container', "flex flex-row w-full h-full overflow-hidden");
      const videoCombineContainer = getDiv('videocombine-container', 'JPsubtitle-videocombine-container', "w-auto h-full overflow-hidden relative flex-1");
        const videoContainer = getDiv('video-container', 'JPsubtitle-video-container', "w-full h-full overflow-hidden relative flex justify-center items-center");
      const subtitleCombineContainer = getDiv('subtitlecombine-container', 'JPsubtitle-subtitlecombine-container', "w-[380px] h-full overflow-hidden box-border shadow-[rgba(100,100,100,0.3)_-5px_5px_10px] text-[#ffffffb5] mt-0 bg-[#0f0f0f] !flex-col");
        const functionContainer = getDiv('function-container', 'JPsubtitle-function-container', "justify-start items-center flex flex-row !bg-[rgb(50,50,50)] rounded-b-2xl !p-3 gap-3");
        const resizeContainer = getDiv('resize-container', 'JPsubtitle-resize-container');
          const subtitleContainer = getDiv('subtitle-container', 'JPsubtitle-subtitle-container', "!pt-20 !pl-10 !pr-5 overflow-x-hidden flex flex-col justify-start items-start relative");
          const resizer = getDiv('', 'JPsubtitle-resizer', "w-full h-[10px] !bg-gray-300 rounded-[12px] cursor-row-resize absolute top-[calc(70%-30px)] z-1");
          const chatbotContainer = getDiv('chatbot-container', 'JPsubtitle-chatbot-container', "flex flex-col justify-start items-start relative overflow-auto h-[210px]");
            const dialogueContainer = getDiv('dialogue-container', 'JPsubtitle-dialogue-container', "!p-7 !space-y-7");
        const chatbotfnContainer = getDiv('chatbotfn-container', 'JPsubtitle-chatbotfn-container', "!p-4 !space-x-4 h-[50px] flex flex-row rounded-t-2xl !bg-[rgb(50,50,50)]");
          const chatbotTyping = document.createElement("input")
          const chatbotReset = getBtn('chatbot-reset', 'JPsubtitle-chatbot-reset');
          const chatbotSend = getBtn('chatbot-send', 'JPsubtitle-chatbot-send');
  const lyricsTrainingMod = getDiv('', '', "w-full");

chatbotTyping.addEventListener("keydown", (e) => {
  e.stopImmediatePropagation();
  setTimeout(() => {
    if (chatbotSend.hasAttribute("waiting")) { return; }
    (chatbotTyping.value.trim() === "" ) ? chatbotSend.setAttribute("disabled", "") : chatbotSend.removeAttribute("disabled");
  }, 10)
  if (e.key === "Enter" && !e.shiftKey) {
    if (chatbotSend.hasAttribute("disabled")) { return; }
    handle.clickChatbotSendBtn();
  }
}, true); 

chatbotTyping.setAttribute("placeholder", "請輸入問題")
chatbotTyping.classList.add("outline-none", "text-2xl","!flex-1", "!max-h-[30px]", "!min-h-[25px]", "min-w-0", "whitespace-nowrap")
setChatFnBtn(chatbotReset, handle.clickChatbotResetBtn, "icons/reset.svg", "重置對話")
chatbotSend.setAttribute("disabled", "")
setChatFnBtn(chatbotSend, handle.clickChatbotSendBtn, "icons/up-arrow.svg", "送出")
chatbotfnContainer.classList.add()
chatbotfnContainer.append(chatbotTyping, chatbotReset, chatbotSend);
// dialogueContainer.classList.add(..."!p-7 !space-y-7".split(" "))
chatbotContainer.append(dialogueContainer);
// chatbotContainer.classList.add("!bg-gray-400")
layoutContainer.style.display = "none"
// videoCombineContainer.classList.add("flex-1")
videoCombineContainer.append(videoContainer);
// resizeContainer.classList.add("flex-auto")
// subtitleContainer.classList.add("!bg-gray-500")
resizeContainer.append(subtitleContainer, resizer, chatbotContainer);
functionContainer.classList.add() 
// subtitleCombineContainer.classList.add("!flex-col")
subtitleCombineContainer.append(functionContainer, resizeContainer, chatbotfnContainer);
layoutFlexContainer.append(videoCombineContainer, subtitleCombineContainer);
origMod.append(layoutFlexContainer);
layoutContainer.append(origMod);
document.body.appendChild(layoutContainer);

// 紀錄使用時間
// window.addEventListener('beforeunload', UserTimeToDatabase);

// 字幕
const cc = getDiv('subtitle', 'select-none', "absolute bottom-[80%] left-1/2 rounded-[5px] cursor-grab h-fit flex justify-center items-center !bg-[#3f3f3f]");
cc.style.display = 'none';
layoutContainer.append(cc);
cc.addEventListener('mousedown', handle.ccMousedown);
document.addEventListener('mouseup', handle.ccMouseup);
document.addEventListener('mousemove', handle.ccMousemove);

// resizer
resizer.addEventListener('mousedown', handle.resizeMousedown);
window.addEventListener('resize', handle.windowResize);

// 建按鈕
createFnBtns()

handle.clickChatbotResetBtn()
handle.clickResetBtn()

// 主函數
async function applyCustomLayout(awsip, serverip, hasFile) {
  if (layoutContainer.style.zIndex === 10000) return;
  moviePlayer = document.querySelector('#movie_player');
  video = moviePlayer.querySelector("video");
  if (!moviePlayerParent) {
    moviePlayerParent = moviePlayer.parentNode
  }
  ytpSizeBtn = document.querySelector('.ytp-size-button');
  awsIP = awsip;
  serverIP = serverip;
  document.addEventListener('keydown', handle.pressEsc);
  showContainers();

  if (hasFile) {
    await withLoader(subtitleContainer, async () => {
      if (window.subtitleJson) {return;}
      await new Promise((resolve, reject) => {
        let count = 0
        const checkData = setInterval(() => {
          if (window[dataName] && window[dataName] !== '') { clearInterval(checkData);  resolve() }
          if (count >= 50) { clearInterval(checkData); reject() }
          count++
        }, 100);
      });
    });
    fillSubtitleContainer();
  }
  setTimeout(() => { 
    isResizing = true;
    handle.resizeMousemove({clientY: window.clientY});
    isResizing = false;
  }, 10);
}

function showContainers() {
  videoContainer.append(moviePlayer);
  setTimeout(() => { ytpSizeBtn.click() }, 100)
  if (ytpSizeBtn.getAttribute("data-title-no-tooltip") !== "預設檢視模式") {
    isHalfFull = false
  } else {
    isHalfFull = true
    setTimeout(() => setTimeout(() => { ytpSizeBtn.click() }, 100), 100);
  }
  document.documentElement.style.overflow = 'hidden';
  layoutContainer.style.zIndex = 10000
  layoutContainer.style.display = "flex"
  functionContainer.style.removeProperty('display');
  document.querySelector(".ytp-chrome-controls")?.querySelectorAll('svg').forEach(svg => {
    svg.style.setProperty("padding", "0");
  })
}

function hideContainers() {
  moviePlayerParent.append(moviePlayer)
  setTimeout(() => { ytpSizeBtn.click() }, 100)
  setTimeout(() => { if (isHalfFull) {setTimeout(() => { ytpSizeBtn.click() }, 100)} }, 100)
  document.documentElement.style.overflow = 'auto';
  layoutContainer.style.zIndex = -1
  layoutContainer.style.display = "none"
  functionContainer.style.display = "none"
}

// 主要功能
function getOriginalText() {
  return window.subtitleJson.map(s => s.map(d => d.org).join('')).join('\n');
}

function getSubtitleData() {
  const subtitleData = window.subtitleJson.map((sentenceArray) => {
    return sentenceArray.map((tokenDict) => {
      const { org, kji, kjr, rmj, jpn } = tokenDict;
      return getTokenSpan(org, kji, kjr, rmj, jpn);
    });
  });
  return subtitleData;
}

function fillSubtitleContainer() {
  if (!Array.isArray(window.subtitleJson)) {
    console.error("window.subtitleJson 不是 Array");
    return;
  }

  subtitleContainer.replaceChildren();

  let translatedTextArray = [];
  if (window.translatedText) {
    translatedTextArray = window.translatedText.split('_');
  }

  originalText = getOriginalText();
  subtitleData = getSubtitleData();

  const originalTextArray = originalText.split('\n');
  originalTextArray.forEach((_, i) => {
    const subtitleDiv = getDiv('', 'JPsubtitle-subtitle', "!leading-[35px] rounded-[10px] flex flex-row !mb-[40px] !bg-[#1a1a1a]");
    const subtitleFnDiv = getDiv('', 'JPsubtitle-subtitle-fn');
    const playbtn = getBtn('', 'JPsubtitle-subtitle-skipbtn');
    const copybtn = getBtn('', 'JPsubtitle-subtitle-copybtn');
    const subtitleWrapper = getDiv('', 'JPsubtitle-subtitle-wrapper');
    const orgSubtitleDiv = getDiv('', 'JPsubtitle-original-subtitle', "text-[#ffffffb5] text-[18px]");
    const zhSubtitleDiv = getDiv('', 'JPsubtitle-chinese-subtitle', "text-[#9c9c9c] text-[15px]");
    subtitleWrapper.classList.add("!p-5", "grid", "place-items-center")
    subtitleWrapper.append(orgSubtitleDiv, zhSubtitleDiv);
    setSubtitleBtn(playbtn, handle.clickPlayBtn, "icons/play.svg", "跳到此句")
    setSubtitleBtn(copybtn, handle.clickCopyBtn, "icons/copy.svg", "複製到聊天欄")
    subtitleFnDiv.append(playbtn, copybtn);
    subtitleFnDiv.classList.add(..."flex-none flex flex-col gap-3 !p-3 !bg-[rgb(100,100,100)] rounded-l-lg".split(" "))
    // subtitleFnDiv.classList.add("hidden")
    subtitleDiv.append(subtitleFnDiv, subtitleWrapper);
    subtitleContainer.appendChild(subtitleDiv);

    subtitleData[i].forEach(token => orgSubtitleDiv.appendChild(token));
    if (window.translatedText) {
      const zhSpan = document.createElement("span");
      zhSpan.innerText = translatedTextArray[i] || "";
      zhSubtitleDiv.appendChild(zhSpan);
    }
  });
}

function getTokenSpan(org, kji, kjr, rmj, jpn) {
  const span = document.createElement('span');

  // 裝平假名
  if (kji === '-1') {
    const ruby = document.createElement('ruby');
    const rt = document.createElement('rt');
    rt.classList.add('select-none', "text-[#ff4f7e]", "text-base");
    ruby.classList.add('hira')
    ruby.appendChild(document.createTextNode(org));
    ruby.appendChild(rt);
    span.appendChild(ruby);
  } 
  else {
    const indices = kji.split('').map(Number);
    let readingIndex = 0;

    for (let i = 0; i < org.length; i++) {
      const ruby = document.createElement('ruby');
      const rt = document.createElement('rt');
      rt.classList.add('select-none', "text-[#ff4f7e]", "text-base");
      ruby.classList.add('hira')
      if (indices.includes(i)) {
        let e = i;
        while (e < org.length && indices.includes(e)) { e++; }
        ruby.appendChild(document.createTextNode(org.slice(i, e)));
        rt.innerText = kjr.split(':')[readingIndex++] || '';
        i = e - 1;
      } 
      else {
        ruby.appendChild(document.createTextNode(org[i]));
      }
      ruby.appendChild(rt);
      span.appendChild(ruby);
    }
  }
  // 裝平假名

  // 裝羅馬拼音
  const ruby = document.createElement('ruby');
  const rt = document.createElement('rt');
  rt.classList.add('select-none', "!text-xl", "font-mono", "text-[#ff4f7e]");
  ruby.classList.add('roma', 'mx-1', 'hidden') // 預設隱藏
  ruby.appendChild(document.createTextNode(org));
  rt.innerText = jpn ? rmj: '' ;
  ruby.appendChild(rt);
  span.appendChild(ruby);
  // 裝羅馬拼音

  return span
}

function initTimestampData() {
  const data = window.forceAlignmentData;
  if (!Array.isArray(data)) { 
    console.error("window.forceAlignmentData 不是 Array");
    return; 
  }
  timestampData = [];
  data.forEach((dict) => {
    // tr: transcript, s: start, e: end
    const { tr, s, e } = dict;
    timestampData.push({ start: s, end: e }); 
  })
  console.log("timestampData", timestampData);
}

function inputDialogueContainer(inputText) {
  const dialogueDiv = getDiv("", "JPsubtitle-dialogue-userbox");
  dialogueDiv.classList.add(..."relative flex flex-col w-full gap-1 items-end".split(" "))
  const textBox = document.createElement("div")
  textBox.classList.add(..."relative rounded-3xl !px-5 !py-2.5 !bg-[rgb(50,50,50)] max-w-[70%]".split(" "))
  const text = document.createElement("div")
  text.classList.add(..."text-white text-2xl whitespace-pre-wrap break-words".split(" "))
  text.innerText = inputText;
  textBox.append(text)
  dialogueDiv.append(textBox);
  dialogueContainer.append(dialogueDiv);
  chatbotTyping.value = "";
  dialogueContainer.scrollTop = dialogueContainer.scrollHeight; // 滑到最下面
  dialogueData.push({ role: "user", content: inputText });
  return inputText
}

function waitDialogueContainer() {
  const waitDiv = getDiv("", "JPsubtitle-dialogue-waitingbox");
  waitDiv.classList.add(..."w-full !py-5".split(" "))
  const circleDiv = document.createElement("div")
  circleDiv.classList.add(..."animate-pulse size-7 rounded-full !bg-gray-200".split(" "))
  waitDiv.append(circleDiv)
  dialogueContainer.append(waitDiv);
  dialogueContainer.scrollTop = dialogueContainer.scrollHeight; // 滑到最下面
  chatbotSend.setAttribute("waiting", "");
  chatbotSend.disabled = true;
}

function processingDialogueContainer(result) {
  if (result.statusCode === 200) {
    dialogueData.push({ role: "assistant", content: result.data });
    const waitDiv = dialogueContainer.querySelector(".JPsubtitle-dialogue-waitingbox")
    if (waitDiv) { waitDiv.remove() }
    const dialogueDiv = getDiv("", "JPsubtitle-dialogue-chatbotbox")
    dialogueDiv.classList.add(..."relative flex flex-col w-full gap-1".split(" "))
    const textBox = document.createElement("div")
    textBox.classList.add(..."relative rounded-3xl !px-2 !py-2.5 max-w-[100%]".split(" "))
    const text = document.createElement("div")
    text.classList.add(..."text-white text-2xl whitespace-pre-wrap break-words".split(" "))
    textBox.append(text)
    dialogueDiv.append(textBox);
    dialogueContainer.append(dialogueDiv);
    for (let i = 0; i < result.data.length; i++) {
      setTimeout(() => {
        text.innerText += result.data[i];
        dialogueContainer.scrollTop = dialogueContainer.scrollHeight; // 滑到最下面
      }, i*50);
    }
  } else {
    const errorDiv = getDiv("", "JPsubtitle-dialogue-errorbox")
    errorDiv.innerText = result.error
    dialogueContainer.append(errorDiv)
  }
  dialogueContainer.scrollTop = dialogueContainer.scrollHeight; // 滑到最下面
  chatbotSend.removeAttribute("waiting");
  if (chatbotTyping.value.trim() !== "" ) {
    chatbotSend.disabled = false;
  }
}

// 創造按鈕
function getFnBtn(name, handleFn, svgPath="", text="", tipText="", defaultOff=false, addClassStr="", delClassStr="") {
  const btnDiv = getDiv("", "JPsubtitle-btn", "whitespace-nowrap relative flex items-center justify-center cursor-pointer !bg-[rgba(128,128,128,0.1)]")
  btnDiv.classList.add(name, "select-none", "!bg-white", "w-[36px]", "h-[36px]", "ring-2", "ring-gray-500", "rounded-full", 
    "hover:!bg-gray-300", "group",
  )
  if (addClassStr) {
    btnDiv.classList.add(...(addClassStr.split(" ")))
  }
  if (delClassStr) {
    btnDiv.classList.remove(...(delClassStr.split(" ")))
  }
  btnDiv.addEventListener("click", handleFn)
  if (svgPath) {
    const svgDiv = getDiv("", "JPsubtitle-svg-icon", "flex h-[80%] w-[80%] items-center justify-center")
    if (defaultOff) {
      svgDiv.classList.add("opacity-50")
    }
    putSvg(svgDiv, svgPath)
    btnDiv.append(svgDiv)
  }
  if (text) {
    const textDiv = getDiv("", "JPsubtitle-text")
    textDiv.classList.add("text-md", "font-medium")
    textDiv.classList.add((defaultOff) ? "!text-gray-400" : "!text-black")
    textDiv.innerText = text
    btnDiv.append(textDiv)
  }
  if (tipText) {
    const tipDiv = getDiv("", "JPsubtitle-tip", "JPsubtitle-tip pointer-events-none group-hover:opacity-100 opacity-0 absolute top-full left-1/2 -translate-x-1/2 !bg-[#333] text-white !p-2.5 rounded-[5px] whitespace-nowrap z-[10001] h-fit")
    tipDiv.innerText = tipText
    btnDiv.append(tipDiv)
  }
  return btnDiv
}

function setChatFnBtn(btnDiv, handleFn, svgPath="", tooltip="") {
  btnDiv.classList.add(..."select-none !bg-white rounded-full w-[36px] h-[36px] cursor-pointer hover:!bg-gray-300 relative group disabled:!bg-gray-700 disabled:cursor-default".split(" "))
  btnDiv.addEventListener("click", handleFn)
  const svgDiv = getDiv("", "JPsubtitle-svg-icon")
  svgDiv.classList.add("flex", "items-center", "justify-center", "!p-2")
  putSvg(svgDiv, svgPath)
  if (tooltip !== "") {
    const tooltipDiv = getDiv("", "JPsubtitle-tooltip", "JPsubtitle-tooltip absolute bottom-full left-1/2 -translate-x-1/2 z-1 pointer-events-none opacity-0 group-hover:opacity-100 inline-block text-xl font-medium text-white transition-opacity duration-300 !bg-gray-700 !my-2 !px-3 !py-2 whitespace-nowrap rounded group-disabled:invisible")
    tooltipDiv.innerText = tooltip
    btnDiv.append(tooltipDiv)
  }
  btnDiv.append(svgDiv)
}

async function setSubtitleBtn(btnDiv, handleFn, svgPath="", tooltip="") {
  btnDiv.classList.add(..."h-[25px] w-[25px] rounded-full bg-gray-300 ring-2 ring-gray-400 grid place-items-center cursor-pointer hover:bg-gray-400 transition group".split(" "))
  const svgDiv = getDiv("", "JPsubtitle-svg-icon")
  svgDiv.classList.add("flex", "items-center", "justify-center", "h-[25px]", "w-[25px]")
  putSvg(svgDiv, svgPath)
  btnDiv.addEventListener("click", handleFn)
  if (tooltip !== "") {
    const tooltipDiv = getDiv("", "JPsubtitle-tooltip") 
    tooltipDiv.innerText = tooltip
    tooltipDiv.classList.add(..."JPsubtitle-tooltip absolute -translate-y-5/5 z-1 pointer-events-none opacity-0 group-hover:opacity-100 inline-block text-lg text-white transition-opacity duration-300 !bg-gray-700 !p-2 whitespace-nowrap rounded group-disabled:invisible".split(" "))
    btnDiv.append(tooltipDiv)
  }
  btnDiv.append(svgDiv)
}

function createFnBtns() {
  const btnArgs = [
    { name: "reset", handleFn: handle.clickResetBtn, svgPath: "icons/reset.svg", tipText: "清除字幕"},
    { name: "translate", handleFn: handle.clickTranslateBtn, svgPath: "icons/translate.svg", tipText: "翻譯字幕"},
    { name: "close", handleFn: handle.clickCloseBtn, svgPath: "icons/close.svg", tipText: "關閉", addClassStr: "absolute top-[8px] right-[5px]", delClassStr: "relative"},
    { name: "jaOrZh", handleFn: handle.clickJaOrZhBtn, text: "日中", tipText: "顯示語言"},
    { name: "hiraOrRoma", handleFn: handle.clickHiraOrRoma, text: "平假名", tipText: "讀音標示"},
    { name: "cc", handleFn: handle.clickcc, svgPath: "icons/subtitles.svg", tipText: "顯示懸浮字幕", defaultOff: true},
    { name: "autoScroll", handleFn: handle.clickAutoScroll, svgPath: "icons/arrowDown.svg", tipText: "自動滾動字幕"},
  ]
  btnArgs.forEach(({name, handleFn, svgPath, text, tipText, defaultOff, addClassStr, delClassStr}) => {
    const btn = getFnBtn(name, handleFn, svgPath, text, tipText, defaultOff, addClassStr, delClassStr)
    const tip = btn.querySelector('.JPsubtitle-tip');
    if (!tip) {return}
    functionContainer.append(btn)
  })
}


// API
async function callAPI(action, data) {
  if (!chrome.runtime?.id) {
    console.warn("擴充功能的背景頁面已經關閉，請重新載入");
  }
  console.log(`content.js -> callAPI(${action}, ${JSON.stringify(data)})`);
  return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({action: action, data: data}, (response) => {
          if (chrome.runtime.lastError) {
              console.error(`content.js -> callAPI(${action}) -> ${chrome.runtime.lastError.message}`);
              reject(chrome.runtime.lastError.message);
          } else if (!response) {  // 確保有回應
              console.error(`content.js -> callAPI(${action}) -> 無回應`);
              reject("無回應");
          } else {
              console.log(`content.js -> callAPI(${action}) -> response:`, response);
              resolve(response);
          }
      });
  });
}

async function callLLM(llm_action, str_input, history) {
  if (llm_action === "chat") {
    if (originalText !== "" && history.findIndex(item => item.role === "developer" && item.content.startsWith("lyrics:")) === -1) {
      history.push({ role: "developer", content: `lyrics: ${originalText}` });
    }
    if (history.findIndex(item => item.role === "developer" && item.content.startsWith("the title of youtube video:")) === -1) {
      history.push({ role: "developer", content: `the title of youtube video: ${document.title.replace(" - YouTube", "").trim()}` });
    }
  }
  const action = "callLLM";
  const data = { 
    awsIP: awsIP, 
    serverIP: serverIP,
    apikey: openaiApiKey, 
    history: history, 
    str_input: str_input, 
    action: llm_action 
  };
  return await callAPI(action, data)
}

async function UserTimeToDatabase() {
  console.log("chrome.runtime.id", chrome.runtime?.id); // 看看是不是 undefined
  try {
    const action = "UserTimeToDatabase";
    const using_time = await new Promise((resolve, reject) => {
      chrome.storage.local.get("using_time", (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.using_time);
        }
      });
    });
    const data = { ip: awsIP, userTime: using_time };
    return await callAPI(action, data);
  } catch (e) {
    console.error("UserTimeToDatabase 錯誤", e);
  }
}

async function putSvg(svgParent, filePath) {
  fetch(chrome.runtime.getURL(filePath))
  .then(response => response.text())
  .then(svg => {svgParent.innerHTML = svg})
  .catch(error => console.error("SVG error: ",error))
}

async function putPng(pngParent, filePath) {
  fetch(chrome.runtime.getURL(filePath))
  .then(response => response.blob())
  .then(blob => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    pngParent.appendChild(img);
  })
  .catch(error => console.error("PNG error: ",error))
}

// utils
function getDiv(id, className, tailwindcss) {
  const div = document.createElement('div');
  div.id = id;
  div.className = className;
  tailwindcss?.split(" ")?.forEach(cls => div.classList.add(cls));
  return div;
}

function getBtn(id, className) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = className;
  return btn;
}

async function withLoader(loaderParent, fn) {
  if (loaderParent.hasChildNodes()) { 
    console.error("loaderParent不該有子元素")
    return 
  }
  const loader = getDiv('', 'loader', "!m-auto w-[40px] h-[40px] rounded-full !border-10 !border-[#EAF0F6] !border-t-[10px] !border-t-[#FF7A59] animate-spin");
  loaderParent.appendChild(loader)

  try {
    await fn()
  } catch (error) {
    console.error("Error in withLoader:", error);
  } finally {
    if (loaderParent === loader.parentElement) {
      loaderParent.removeChild(loader); 
    }
  }
}

