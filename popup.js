var awsIP = env.awsIP;
var serverIP = env.serverIP;
var expStr = env.expStr;
var hasFile = false;
var stopFileInputInterval = false;

// 會觸發到上傳字幕檔案的按鈕們
// 目前有 local 存有 disablefileInputButton, disablefileInputProgress, disableSearchSongButton, disableSearchSongProgress
const FILE_INPUT_BUTTONS = ["fileInputButton", "searchSongButton"];
const FILE_INPUT_BUTTONS_DISABLE_KEYS = ["disableFileInputButton", "disableSearchSongButton"];
const FILE_INPUT_BUTTONS_PROGRESS_KEYS = ["disableFileInputProgress", "disableSearchSongProgress"];
const FILE_INPUT_ORG_HTML = ["選擇檔案", "搜尋"];
const FILE_INPUT_BUSY_KEY = "fileInputBusy";

// 按鈕等待時切換的HTML
const LOADING_BUTTON_HTML = `<span class="spinner"></span> <span id="progressText">處理中...</span>`;

const INTERVAL_TIME = 200;

function setFileInputButtonsDisabledState(isDisabled) {
  FILE_INPUT_BUTTONS.forEach(buttonId => {
    const button = document.getElementById(buttonId);
    if (!button) {return;}
    button.dataset.disabled = isDisabled ? "true" : "false";
  });
}

function setFileInputButtonAbleCancelState(button, isAbleCancel) {
  if (typeof button === 'string') {
    button = document.getElementById(button);
  }
  if (!button) return;
  button.dataset.ableCancel = isAbleCancel ? "true" : "false";
}

function changeButtonProgressText(button, text) {
  if (typeof button === 'string') {
    button = document.getElementById(button);
  }

  const progressSpan = button.querySelector('#progressText');

  if (progressSpan) {
    progressSpan.textContent = text;
  }
}

async function startLoadingButtonProgressInterval({ buttonId, disableKey, progressKey, btnOrgHTML}) {
  const button = document.getElementById(buttonId);
  setInterval(async () => {
    if (stopFileInputInterval) { return; }
    // 先取得按鈕狀態跟全局鎖
    let state = await chrome.storage.local.get([disableKey, progressKey, FILE_INPUT_BUSY_KEY]);
    let disabled = state[disableKey] || false;
    let progress = state[progressKey] || 0;
    let busy = state[FILE_INPUT_BUSY_KEY] || false;

    if (disabled && busy) {
      // 按鈕被鎖且全局忙碌
      setFileInputButtonsDisabledState(true);
      if (!button.querySelector("#progressText")) {
        button.innerHTML = LOADING_BUTTON_HTML;
      }
      changeButtonProgressText(button, `處理中... ${progress}%`);
    } else if (!disabled && !busy) {
      // 沒忙就還原
      setFileInputButtonsDisabledState(false);
      button.innerHTML = btnOrgHTML;
    }
  }, INTERVAL_TIME);
}

async function startLoadingButton({ disableKey, progressKey }) {
  // 設全局鎖
  await chrome.storage.local.set({ [FILE_INPUT_BUSY_KEY]: true, [disableKey]: true, [progressKey]: 0 });
}

// 操作結束時釋放鎖
async function stopLoadingButton({ disableKey, progressKey }) {
  await chrome.storage.local.set({ [FILE_INPUT_BUSY_KEY]: false, [disableKey]: false, [progressKey]: 0 });
}

async function startDisplayErrorMessageInterval() {
  setInterval(async () => {
    let { displayErrorMessage, displayErrorMessageDetail } = await chrome.storage.local.get(["displayErrorMessage", "displayErrorMessageDetail"]);
    if (!displayErrorMessage) return;
    alert(displayErrorMessageDetail || "發生錯誤，請再試一次");
    await chrome.storage.local.set({ displayErrorMessage: false, displayErrorMessageDetail: "" });
  }, INTERVAL_TIME);
}

const defaultResponseDebugMsg = (fnName, response) => {
  console.log(`popjs.js -> ${fnName}() -> response:`, response);
}

function isMostlyJapanese(str) {
  // 日文字符範圍：平假名、片假名、日文漢字
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g;

  // 全部的可見字符（不含空白）
  const visibleChars = str.replace(/\s/g, '').length;
  if (visibleChars === 0) return false; // 空字串直接 false

  // 符合日文範圍的字數
  const japaneseCount = (str.match(japaneseRegex) || []).length;

  // 判斷日文比例是否超過一半
  return japaneseCount / visibleChars >= 0.5;
}

function normalizeNewlines(str) {
  return str
    .replace(/\r\n/g, '\n')   // 換掉 Windows 換行
    .replace(/\r/g, '\n')     // 換掉舊 Mac 換行
    .split('\n')              // 切成行
    .filter(line => line.trim() !== "") // 去掉全空白的行
    .join('\n');              // 再拼回去
}

const getTab = () => {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        resolve(tabs[0]);
      } else {
        reject('No active tab found');
      }
    });
  });
};

async function callAPI(action, data) {
  console.log(`popup.js -> callAPI(${action}, ${JSON.stringify(data)})`);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({action: action, data: data}, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`popup.js -> callAPI(${action}) -> ${chrome.runtime.lastError.message}`);
        reject(chrome.runtime.lastError.message);
      } else if (!response) {  // 確保有回應
        console.error(`popup.js -> callAPI(${action}) -> 無回應`);
        reject("無回應");
      } else if (response.error) {  // 如果 response 有 error 屬性，表示有錯誤
        console.error(`popup.js -> callAPI(${action}) -> error:`, response.error);
        reject(response.error);
      } else {
        console.log(`popup.js -> callAPI(${action}) -> response:`, response);
        resolve(response);
      }
    });
  });
}

const sendData = async (data, name) => {
  const tab = await getTab();
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [data, name],
    func: (data, name) => { window[name] = data }
  });
  return new Promise((resolve) => {
    setTimeout(() => { resolve(); }, 1000); // 等待 1 秒鐘，確保資料已經傳遞到 content.js
  });
};

async function handleDOMContentLoaded() {
  // 保存已輸入的 apiKey 到輸入框
  document.getElementById('searchSinger').value = localStorage.getItem('searchSinger') || "";
  document.getElementById('searchSong').value = localStorage.getItem('searchSong') || "";

  // 更新上傳檔案按鈕的間隔器
  FILE_INPUT_BUTTONS.forEach((_, index) => {
    startLoadingButtonProgressInterval({
      buttonId: FILE_INPUT_BUTTONS[index],
      disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[index],
      progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[index],
      btnOrgHTML: FILE_INPUT_ORG_HTML[index]
    });
  });

  // 錯誤訊息間隔器
  startDisplayErrorMessageInterval();
  
  // 檢查當前頁面是否為 YouTube 影片頁面
  const tab = await getTab()
  if (tab.url.includes("youtube.com/watch")) { return }
  document.getElementById('splitButton').style.display = 'none';
  document.getElementById('subtitleForm').style.display = 'none';
  document.getElementById('notEffective').style.display = 'block';
}

async function handleSplitButton() {
  const tab = await getTab();
  let [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => !!document.getElementById('custom-layout')
  });

  // 如果 custom-layout 不存在，就先執行 content.js
  if (!result.result) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js', 'tailwind.js'] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
  }
  await chrome.scripting.executeScript({ 
    target: { tabId: tab.id },
    args: [awsIP, serverIP, hasFile],
    func: (awsIP, serverIP, hasFile) => applyCustomLayout(awsIP, serverIP, hasFile)
  });
  // setTimeout(() => { chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['youtube_api.js'] }); }, 100);
  setTimeout(() => { hasFile = false }, 1000);
}

async function handleFileInput() {
  const file = this.files[0];
  if (!file) { 
    return; 
  }

  let jpString = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file, 'UTF-8');
  })

  if (!isMostlyJapanese(jpString)) {
    alert("偵測檔案內容不當，請確認後再上傳");
    return;
  }

  jpString = normalizeNewlines(jpString);

  startLoadingButton({ 
    disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[0], 
    progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[0]
  });
  setFileInputButtonAbleCancelState(FILE_INPUT_BUTTONS[0], true);
  
  try {
    const tab = await getTab();
    const data = { jpString: jpString.trim(), awsIP: awsIP, tab: tab, serverIP: serverIP, filter: false };
    const response = await callAPI("handlefileInput", data);
    defaultResponseDebugMsg("handlefileInput", response);
  } catch (error) {
    console.error('上傳文件時出錯:', error)
  } finally {
    stopLoadingButton({ 
      disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[0], 
      progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[0]
    });
    setFileInputButtonAbleCancelState(FILE_INPUT_BUTTONS[0], false);
  }
}

async function handleFileInputButton() {
  const button = document.getElementById('fileInputButton');
  if (button.dataset.disabled === "true" && button.dataset.ableCancel === "true") {
    stopLoadingButton({ 
      disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[0], 
      progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[0]
    });
    await callAPI("addUploadId", {});
    return;
  }
  if (button.dataset.disabled === "true") {
    return;
  }
  document.getElementById('fileInput').click();
}

async function handleExampleFileButton() {
  // 下載範例檔案
  const blob = new Blob([expStr], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '範例歌詞檔案.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleSearchSongButton() {
  const button = document.getElementById('searchSongButton');
  if (button.dataset.disabled === "true" && button.dataset.ableCancel === "true") {
    stopLoadingButton({ 
      disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[1], 
      progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[1]
    });
    await callAPI("addUploadId", {});
    console.log("已取消搜尋");
    return;
  }
  if (button.dataset.disabled === "true") {
    return;
  }
  
  const singer = document.getElementById('searchSinger').value;
  const song = document.getElementById('searchSong').value;

  if (singer === "" || song === "") {
    alert("請輸入歌手和歌曲名稱");
    return;
  }
  setFileInputButtonAbleCancelState(FILE_INPUT_BUTTONS[1], true);
  startLoadingButton({ 
    disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[1], 
    progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[1] 
  });

  try {
    const tab = await getTab();
    const data1 = { singer: singer, song: song, awsIP: awsIP, tab: tab, serverIP: serverIP };
    const response1 = await callAPI("searchSong", data1);
    defaultResponseDebugMsg("searchSong", response1);
  } catch (error) {
    console.error('搜尋時出錯:', error);
  } finally {
    stopLoadingButton({ 
      disableKey: FILE_INPUT_BUTTONS_DISABLE_KEYS[1], 
      progressKey: FILE_INPUT_BUTTONS_PROGRESS_KEYS[1]
    });
    setFileInputButtonAbleCancelState(FILE_INPUT_BUTTONS[1], false);
  }
}

function handleHoverFileInputButton(event) {
  const button = event.currentTarget;
  if (button.dataset.disabled === "true" && button.dataset.ableCancel === "true") {
    stopFileInputInterval = true;
    changeButtonProgressText(button, `取消`);
  }
}

function handleUnhoverFileInputButton() {
  if (stopFileInputInterval) {
    stopFileInputInterval = false;
  }
}

function handleHoverSearchSongButton(event) {
  handleHoverFileInputButton(event);
}

function handleUnhoverSearchSongButton() {
  handleUnhoverFileInputButton();
}


document.getElementById('searchSinger').addEventListener('input', () => {
  localStorage.setItem('searchSinger', document.getElementById('searchSinger').value)
});
document.getElementById('searchSong').addEventListener('input', () => {
  localStorage.setItem('searchSong', document.getElementById('searchSong').value)
});
document.getElementById('searchSongButton').addEventListener('click', handleSearchSongButton);
document.getElementById('searchSongButton').addEventListener('mouseover', handleHoverSearchSongButton);
document.getElementById('searchSongButton').addEventListener('mouseout', handleUnhoverSearchSongButton);
document.getElementById('fileInputButton').addEventListener('click', handleFileInputButton);
document.getElementById('fileInputButton').addEventListener('mouseover', handleHoverFileInputButton);
document.getElementById('fileInputButton').addEventListener('mouseout', handleUnhoverFileInputButton);
document.getElementById('exampleFileButton').addEventListener('click', handleExampleFileButton);
document.getElementById('fileInput').addEventListener('change', handleFileInput);
document.addEventListener('DOMContentLoaded', handleDOMContentLoaded);
document.getElementById('splitButton').addEventListener('click', handleSplitButton);
