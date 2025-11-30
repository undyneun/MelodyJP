console.log("Background script 正在運行！ヽ(✿ﾟ▽ﾟ)ノ");
const RETURN = (message, data, statusCode) => ({ message, data, statusCode });
let tab_id = null;
var i1 = null;
var currentUploadId = 0;
const CANCEL_MESSAGE = "已取消";

function validateDataKeys(data, keys, fnName) {
  const missingKeys = keys.filter(key => !(key in data) || data[key] === null || data[key] === undefined);
  if (missingKeys.length > 0) {
    console.error(`background.js -> ${fnName}() -> 缺少: ${missingKeys.join(", ")}`);
    return RETURN(`缺少: ${missingKeys.join(", ")}`, null, 500);
  }
  return null;
}

const defaultDebugMsg = (fnName, json) => {
  console.log(`background.js -> ${fnName}() -> data: ${JSON.stringify(json)}`);
  if (!json.statusCode) {return;}
  switch (json.statusCode) {
    case 200:
      console.log(`background.js -> ${fnName}() -> statusCode = 200`); break;
    case 401:
      console.error(`background.js -> ${fnName}() -> statusCode = 401 ->`, json.message); break;
    case 500:
      console.error(`background.js -> ${fnName}() -> statusCode = 500 ->`, json.message); break;
    default:
      console.error(`background.js -> ${fnName}() 的 response.statusCode 發生意外錯誤`); break;
  }
}

const sendData = async (tab, data, name) => {
  chrome.tabs.sendMessage(tab.id, { action: "sendData", data: data, name: name })
  setTimeout(()=>{ // 等待1秒鐘，確保資料已發送
    return new Promise((resolve, reject) => { resolve(); })
  }, 1000)
};

async function fetchWithLog(fnName, url, body, credentials, method='post') {
  // log request的資訊和response的資訊, response的statusCode!=2XX要報錯
  console.log(`background.js -> ${fnName}() -> request body:`, body);
  try {
    const res = await fetch(url, {
      method: method,
      credentials: credentials,
      headers: {'Content-Type': 'application/json'},
      body: method.toLowerCase() !== 'get' ? JSON.stringify(body) : undefined
    });
    const resBody = await res.json();
    console.log(`background.js -> ${fnName}() -> response data:`, resBody);
    if (!res.ok) {
      throw new Error(resBody.message || `HTTP error! status: ${res.status}`);
    }
    return resBody;
  } catch(e) {
    console.error(`background.js -> ${fnName}() -> fetch error:`, e);
    throw e;
  }
}

// helper
function updateProgress(progressName, value) {
  chrome.storage.local.set({ [progressName]: value });
}

async function step(progressName, startProgress, finishProgress, asyncFn, thisUploadId) {
  try {
    if (startProgress) {
      updateProgress(progressName, startProgress);
    }
    const result = await asyncFn();
    if (finishProgress) {
      updateProgress(progressName, finishProgress);
    }

    if (thisUploadId && thisUploadId !== currentUploadId) {
      throw new Error(CANCEL_MESSAGE);
    }
    return result;
  } catch (error) {
    if (thisUploadId && thisUploadId !== currentUploadId) {
      throw new Error(CANCEL_MESSAGE);
    }
    throw error;
  }
}
// helper

async function handlefileInput(data) {
  /* 
      先拿輸入日文歌詞的平假名與歌曲轉錄稿的平假名做比對，篩選要的歌詞再放入Forced Alignment
  */ 
  // data: {awsIP: string, jpString: string, tab: obj, serverIP: string, filter: boolean}
  const missingCheck = validateDataKeys(data, ["awsIP", "jpString", "tab", "serverIP", "filter"], "handlefileInput");
  if (missingCheck) return missingCheck;
  let video_id, parsedData, romajiData, inputOriginKatakanaPairsData, transcriptionKatakanaData, finalJpString;
  try {
    const thisUploadId = ++currentUploadId;
    const serverIP = data.serverIP; 
    const ip = data.awsIP;
    const jpString = data.jpString;
    const filter = data.filter;
    const tab = data.tab;
    const url = tab.url;
    video_id = url.split("v=")[1]?.split("&")[0];
    
    // sendData 前先確保 content.js 已經載入
    await step("disableFileInputProgress", 2, 5, async () => {
      let [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => !!document.getElementById('custom-layout') 
      });
      if (!result.result) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js', 'tailwind.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
      }
    });

    // check_FA_cache
    const check_FA_cache_response = await step("disableFileInputProgress", 5, 7, async () => {
      return await fetchWithLog(
        "handlefileInput - check_FA_cache", 
        ip + "/useDynamoDB", 
        {
          action: "check_FA_cache",
          video_id: video_id,
          jpString: jpString
        },
        'include'
      );
    }, thisUploadId);
    if (check_FA_cache_response.data["FA_data"]) { // cache hit
      await step("disableFileInputProgress", 90, 100, async () => {
        await sendData(tab, check_FA_cache_response.data["parsed_data"], "subtitleJson");
        chrome.scripting.executeScript({ 
          target: { tabId: tab.id },
          function: () => fillSubtitleContainer()
        });
        await sendData(tab, check_FA_cache_response.data["FA_data"], "forceAlignmentData");
        chrome.scripting.executeScript({ 
          target: { tabId: tab.id },
          function: () => initTimestampData()
        });
      }, thisUploadId);
      return RETURN("Done", {"check_FA_cache_response": check_FA_cache_response}, 200);
    }
    // check_FA_cache

    // 先檢查 S3 是否已經有只有人聲音檔，沒有的話從頭下載、篩人聲、上傳
    const exists_response = await step("disableFileInputProgress", 17, 20, async () => {
      return await fetchWithLog(
        "handlefileInput - check_if_exists_S3", 
        ip+"/check_if_exists_S3", 
        { filename: `${video_id}.mp3`, bucket: "melodyjp-ytmp3" },
        'omit'
      );
    }, thisUploadId);
    if (!exists_response.data) {
      // TODO: uvr5不必要
      await step("disableFileInputProgress", 22, null, async () => {
        await fetchWithLog(
          "handlefileInput - download_YT_upload_S3", 
          serverIP+"/download_YT_upload_S3", 
          { video_id: video_id },
          'omit'
        );
      }, thisUploadId);      
    }
    // 先檢查 S3 是否已經有只有人聲音檔，沒有的話從頭下載、篩人聲、上傳
    
    // 不篩選直接 forced alignment
    if (!filter) { 
      finalJpString = jpString;
      updateProgress("disableFileInputProgress", 65);
    } 
    else {
      // 從 S3 下載人聲音檔並跑 whisperx
      const whisperx_response = await step("disableFileInputProgress", 42, 60, async () => {
        return await fetchWithLog(
          "handlefileInput - download_from_S3_run_whisperx", 
          serverIP+"/download_from_S3_run_whisperx", 
          { video_id: video_id },
          'omit'
        );
      }, thisUploadId);
      let whisperxData = whisperx_response.data;
      // 從 S3 下載人聲音檔並跑 whisperx

      // 拿轉錄稿的平假名
      const parse_response2 = await step("disableFileInputProgress", 62, 65, async () => {
        return await fetchWithLog(
          "handlefileInput - parse", 
          ip+"/parse", 
          { jpString: whisperxData },
          'omit'
        );
      }, thisUploadId);
      transcriptionKatakanaData = parse_response2.data.katakana;
      // 拿轉錄稿的平假名

      // 拿輸入日文歌詞的原形、平假名對
      const parse_response1 = await step("disableFileInputProgress", 12, 15, async () => {
        return await fetchWithLog(
          "handlefileInput - parse", 
          ip+"/parse", 
          { jpString: jpString },
          'omit'
        );
      }, thisUploadId);
      inputOriginKatakanaPairsData = parse_response1.data.origin_katakana_pairs;
      // 拿輸入日文歌詞的原形、平假名對

      // 篩出要forced alignment的歌詞段落
      const filter_response = await step("disableFileInputProgress", 65, 67, async () => {
        return await fetchWithLog(
          "handlefileInput - filter_lyrics", 
          ip+"/filter_lyrics", 
          { 
            lyrics: inputOriginKatakanaPairsData,
            whisperx_output: transcriptionKatakanaData
          },
          'omit'
        );
      }, thisUploadId);
      finalJpString = filter_response.data;
      // 篩出要forced alignment的歌詞段落
    }
    
    // 拿到輸入日文歌詞的讀音與羅馬拼音
    const parse_response3 = await step("disableFileInputProgress", 70, 72, async () => {
      return await fetchWithLog(
        "handlefileInput - parse", 
        ip+"/parse", 
        { jpString: finalJpString },
        'omit'
      );
    }, thisUploadId);
    parsedData = parse_response3.data.parse;
    romajiData = parse_response3.data.romaji;
    await sendData(tab, parsedData, "subtitleJson");
    chrome.scripting.executeScript({ 
      target: { tabId: tab.id },
      function: () => fillSubtitleContainer()
    });
    // 拿到輸入日文歌詞的讀音與羅馬拼音

    // forceAlignment()
    const FA_response = await step("disableFileInputProgress", 75, 95, async () => {
      return await fetchWithLog(
        "handlefileInput - download_from_S3_forcealignment", 
        serverIP+"/download_from_S3_forcealignment", 
        { 
          video_id: video_id,
          roman_jp: romajiData,
          fromUVR5: false
        },
        'omit'
      );
    }, thisUploadId);
    delete FA_response.data["tr"]
    await sendData(tab, FA_response.data, "forceAlignmentData");
    chrome.scripting.executeScript({ 
      target: { tabId: tab.id },
      function: () => initTimestampData()
    });
    // forceAlignment()

    // write_FA_cache
    await step("disableFileInputProgress", 97, 100, async () => {
      return await fetchWithLog(
        "handlefileInput - write_FA_cache", 
        ip + "/useDynamoDB", 
        { 
          action: "write_FA_cache",
          video_id: video_id,
          jpString: jpString,
          FA_data: FA_response.data,
          parsed_data: parsedData
        },
        'include'
      );
    }, thisUploadId);
    // write_FA_cache
    
    return RETURN("Done", null, 200);
  } catch (error) {
    if (error.message === CANCEL_MESSAGE) {
      return RETURN(CANCEL_MESSAGE, null, 500);
    }
    console.error('background.js -> handlefileInput() 出錯:', error);
    chrome.storage.local.set({ "displayErrorMessage": true, "displayErrorMessageDetail": "上傳檔案時出錯，請再試一次" });
    throw error;
  } finally {
    chrome.storage.local.set({ "disableFileInputButton": false });
  }
}

async function callLLM(data) {
  // data: {awsIP: string, serverIP: string, apikey: string, history: list[dict]|null, action: string, str_input: string}
  const missingCheck = validateDataKeys(data, ["awsIP", "serverIP", "history", "action", "str_input"], "callLLM");
  if (missingCheck) return missingCheck;
  try {
    const awsIP = data.awsIP;
    const serverIP = data.serverIP;
    const apikey = data.apikey;
    const history = data.history;
    const action = data.action;
    const str_input = data.str_input;

    // check_tran_cache
    if (action === "translate") {
      const check_tran_cache_res = await fetch(awsIP + "/useDynamoDB", { 
        method: 'post',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: "check_tran_cache",
          str_input: str_input,
        })
      });
      const check_tran_cache_resBody = await check_tran_cache_res.json();
      console.log("/useDynamoDB -> check_tran_cache", check_tran_cache_resBody);
      if (check_tran_cache_resBody.data["tran_cache"]) { // cache hit
        return RETURN(check_tran_cache_resBody.message, check_tran_cache_resBody.data["tran_cache"], 200);
      }
    }
    // check_tran_cache
    
    // main
    const res = await fetch(serverIP+"/llm", { 
      method: 'post',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        apikey: apikey,
        history: history,
        action: action,
        str_input: str_input
      })
    })
    const resBody = await res.json();
    defaultDebugMsg("callLLM", resBody);
    // main

    // write_tran_cache
    if (action === "translate") {
      const write_tran_cache_res = await fetch(awsIP + "/useDynamoDB", { 
        method: 'post',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: "write_tran_cache",
          str_input: str_input,
          str_output: resBody.data,
        })
      });
      const write_FA_cache_resBody = await write_tran_cache_res.json();
      console.log("/useDynamoDB -> write_tran_cache", write_FA_cache_resBody);
    }
    // write_tran_cache

    return RETURN(resBody.message, resBody.data, res.status);
  } catch (error) {
    console.error('background.js -> callLLM() 出錯:', error);
    return RETURN(error.toString(), null, 500);
  }
}

async function searchSong(data) {
  // data: {awsIP: string, singer: string, song: string, tab: obj, serverIP: string}
  const missingCheck = validateDataKeys(data, ["awsIP", "singer", "song", "tab", "serverIP"], "searchSong");
  if (missingCheck) return missingCheck;

  let i1;
  try {
    const thisUploadId = ++currentUploadId;
    const awsIP = data.awsIP;
    const singer = data.singer;
    const song = data.song;

    const resBody = await step("disableSearchSongProgress", 2, 10, async () => {
      return await fetchWithLog(
        "searchSong", 
        awsIP + "/crawler", 
        { song_name: song, singer: singer },
        'omit'
      );
    }, thisUploadId);

    i1 = setInterval(async () => {
      let { disableFileInputProgress = 0 } = await chrome.storage.local.get(["disableFileInputProgress"]);
      chrome.storage.local.set({"disableSearchSongProgress": 10 + Math.floor(disableFileInputProgress * 0.9) });
      if (disableFileInputProgress === 100) { 
        clearInterval(i1); 
      }
    }, 500);

    await handlefileInput({
      awsIP: awsIP,
      jpString: resBody.data,
      tab: data.tab,
      serverIP: data.serverIP,
      filter: false
    });

    return RETURN(resBody.message, resBody.data, 200);
  } catch (error) {
    if (error.message === CANCEL_MESSAGE) {
      return RETURN(CANCEL_MESSAGE, null, 500);
    } else if (error.message === "找不到歌曲") {
      chrome.storage.local.set({ "displayErrorMessage": true, "displayErrorMessageDetail": "找不到此歌曲" });
    } else {
      console.error('background.js -> searchSong() 出錯:', error);
      chrome.storage.local.set({ "displayErrorMessage": true, "displayErrorMessageDetail": "搜尋歌曲時出錯，請再試一次" });
    }
    throw error;
  } finally {
    if (i1) {
      clearInterval(i1);
    }
    chrome.storage.local.set({ "disableSearchSongButton": false });
  }
}

async function addUploadId() {
  currentUploadId += 1;
  return RETURN("Done", { uploadId: currentUploadId }, 200);
}

action_handler = {
  'handlefileInput': handlefileInput,
  'callLLM': callLLM,
  'searchSong': searchSong,
  'addUploadId': addUploadId,
}

// 接收來自 content.js 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    console.log("background.js 收到訊息:", message);

    const handler = action_handler[message.action];
    if (!handler) {
      console.error("background.js 未定義的 action:", message.action);
      sendResponse({ error: "未知的 action" });
      return;
    }

    // 檢查動作是否需要登入
    // const getLoggedIn = () => {
    //   return new Promise((resolve) => {
    //     chrome.storage.local.get(["loggedIn"], (result) => {
    //         resolve(result.loggedIn || false);
    //     });
    //   });
    // }
    // if (need_login.includes(message.action)) {
    //   const loggedIn = await getLoggedIn();
    //   if (!loggedIn) {
    //     console.error("background.js 未登入，請先登入");
    //     sendResponse({ error: "未登入" });
    //     return;
    //   }
    // }

    try {
      const result = await handler(message.data); // 一律 await（不管是不是 async）
      console.log("background.js 回應資料:", result);
      sendResponse(result);
    } catch (error) {
      console.error("background.js 發生例外:", error);
      sendResponse({ error: "background.js listener 執行 action 時發生錯誤" });
    }
  })();

  return true; // 永遠 return true 保持通道活著
});

// 監聽標籤頁更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!(changeInfo.url)) {return;}
  chrome.tabs.sendMessage(tabId, { action: "urlChanged", data: changeInfo.url }, () => {
    if (chrome.runtime.lastError) {
      // 沒有 content script 時不要報錯
      return;
    }
  });
});

setInterval(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: "backMoviePlayer", data: tab.url }, () => {
        if (chrome.runtime.lastError) {
          // 沒有 content script 時不要報錯
          return;
        }
      });
    }
  });
}, 1000)