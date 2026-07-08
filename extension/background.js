chrome.runtime.onInstalled.addListener(() => {
  console.log('AlgoCrab Extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    fetch('https://algocrab-backend.onrender.com/status')
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});