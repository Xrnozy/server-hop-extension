// Roblox Server Hopper - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // Load and display stats
  loadStats();

  // Button event listeners
  document.getElementById('viewStats').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getStats' }, (stats) => {
      const totalServers = stats.totalServersVisited || 0;
      const totalJoins = stats.totalJoins || 0;
      alert(`📊 Server Hopper Stats\n\nServers Visited: ${totalServers}\nTotal Joins: ${totalJoins}\n\nKeep hopping! 🚀`);
    });
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Are you sure? This will clear all visited server history. This cannot be undone.')) {
      chrome.runtime.sendMessage({ action: 'clearVisitedServers' }, () => {
        document.getElementById('serverCount').textContent = '0';
        document.getElementById('joinCount').textContent = '0';
        alert('✅ History cleared!');
      });
    }
  });
});

function loadStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, (stats) => {
    const totalServers = stats.totalServersVisited || 0;
    const totalJoins = stats.totalJoins || 0;
    
    document.getElementById('serverCount').textContent = totalServers;
    document.getElementById('joinCount').textContent = totalJoins;
  });
}

// Refresh stats every 5 seconds
setInterval(loadStats, 5000);
