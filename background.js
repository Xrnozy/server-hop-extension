// Roblox Server Hopper - Service Worker (Background Script)
// Lightweight storage and event management

// Initialize storage on extension install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['roblox_visited_servers', 'roblox_marked_servers'], (result) => {
    if (!result.roblox_visited_servers) {
      chrome.storage.local.set({ roblox_visited_servers: {} });
    }
    if (!result.roblox_marked_servers) {
      chrome.storage.local.set({ roblox_marked_servers: {} });
    }
  });
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVisitedServers') {
    chrome.storage.local.get(['roblox_visited_servers'], (result) => {
      sendResponse(result.roblox_visited_servers || {});
    });
    return true; // Will respond asynchronously
  }

  if (request.action === 'markServerVisited') {
    const { serverId } = request;
    chrome.storage.local.get(['roblox_visited_servers'], (result) => {
      const visited = result.roblox_visited_servers || {};
      visited[serverId] = {
        visitedAt: new Date().toISOString(),
        joinCount: (visited[serverId]?.joinCount || 0) + 1
      };
      chrome.storage.local.set({ roblox_visited_servers: visited }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === 'clearVisitedServers') {
    chrome.storage.local.set({ roblox_visited_servers: {}, roblox_marked_servers: {} }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'getStats') {
    chrome.storage.local.get(['roblox_visited_servers', 'roblox_marked_servers'], (result) => {
      const visited = result.roblox_visited_servers || {};
      sendResponse({
        totalServersVisited: Object.keys(visited).length,
        totalJoins: Object.values(visited).reduce((sum, v) => sum + (v.joinCount || 0), 0)
      });
    });
    return true;
  }
});
