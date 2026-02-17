// Roblox Server Hopper Content Script
// Lightweight server tracking on join clicks

(function() {
  'use strict';

  const VISITED_SERVERS_KEY = 'roblox_visited_servers';
  const MAX_PLAYERS_PREF_KEY = 'roblox_max_players_pref';
  const SORT_PREF_KEY = 'roblox_sort_pref';
  const REFRESH_RESET_PREF_KEY = 'roblox_refresh_reset_highlights';
  const CONFIG = {
    darkGreenColor: '#054721'  // Bright, visible green
  };

  // Track if an auto-load is in progress to prevent conflicts
  let isAutoLoadInProgress = false;

  // Inject CSS to style visited servers
  function injectCSS() {
    if (document.getElementById('roblox-server-hopper-css')) return;
    
    const style = document.createElement('style');
    style.id = 'roblox-server-hopper-css';
    style.textContent = `
      #roblox-random-join-button,
      #roblox-settings-button {
        display: inline-block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: relative !important;
        z-index: 1000 !important;
      }

      #roblox-random-join-button:hover,
      #roblox-settings-button:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
      }

      .roblox-visited-server {
        border: 2px solid #00b06f !important;
        box-shadow: inset 0 0 0 2px #00b06f !important;
      }

      .roblox-just-joined {
        border: 3px solid #00b06f !important;
        box-shadow: inset 0 0 0 3px #00b06f, 0 0 8px rgba(0, 176, 111, 0.6) !important;
      }
    `;
    document.head.appendChild(style);
    console.log('✅ CSS injected');
  }

  // Get visited servers from storage
  function getVisitedServers() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([VISITED_SERVERS_KEY], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Storage error:', chrome.runtime.lastError);
            resolve({}); // Return empty object on error
            return;
          }
          resolve(result[VISITED_SERVERS_KEY] || {});
        });
      } catch (error) {
        console.warn('⚠️ Extension context error:', error);
        resolve({}); // Return empty object on error
      }
    });
  }

  // Get max players preference from storage
  function getMaxPlayersPreference() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([MAX_PLAYERS_PREF_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve(999); // No limit by default
            return;
          }
          resolve(result[MAX_PLAYERS_PREF_KEY] || 999);
        });
      } catch (error) {
        resolve(999);
      }
    });
  }

  // Set max players preference
  function setMaxPlayersPreference(maxPlayers) {
    try {
      chrome.storage.local.set({ [MAX_PLAYERS_PREF_KEY]: maxPlayers });
      console.log('⚙️ Max players preference set to:', maxPlayers);
    } catch (error) {
      console.warn('⚠️ Could not save max players preference:', error);
    }
  }

  // Get sort preference from storage
  function getSortPreference() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([SORT_PREF_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve('Asc'); // Default to Ascending
            return;
          }
          resolve(result[SORT_PREF_KEY] || 'Asc');
        });
      } catch (error) {
        resolve('Asc');
      }
    });
  }

  // Get refresh reset preference from storage
  function getRefreshResetPreference() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([REFRESH_RESET_PREF_KEY], (result) => {
          if (chrome.runtime.lastError) {
            resolve(true); // Default to true (reset on refresh)
            return;
          }
          resolve(result[REFRESH_RESET_PREF_KEY] !== false); // Default to true
        });
      } catch (error) {
        resolve(true);
      }
    });
  }

  // Set refresh reset preference
  function setRefreshResetPreference(value) {
    try {
      chrome.storage.local.set({ [REFRESH_RESET_PREF_KEY]: value });
      console.log('⚙️ Refresh reset preference set to:', value);
    } catch (error) {
      console.warn('⚠️ Could not save refresh reset preference:', error);
    }
  }

  // Set sort preference
  function setSortPreference(sortOrder) {
    try {
      chrome.storage.local.set({ [SORT_PREF_KEY]: sortOrder });
      console.log('⚙️ Sort preference set to:', sortOrder);
    } catch (error) {
      console.warn('⚠️ Could not save sort preference:', error);
    }
  }

  // Extract player count from status text "X of Y people max"
  function getPlayerCountFromCard(card) {
    const statusEl = card.querySelector('.rbx-game-status');
    if (!statusEl) {
      // Fallback: try to find any element with player count text
      const allText = card.textContent;
      const match = allText.match(/(\d+)\s+of\s+(\d+)/);
      if (match) {
        return {
          current: parseInt(match[1]),
          max: parseInt(match[2])
        };
      }
      return { current: 0, max: 0 };
    }
    
    const text = statusEl.textContent.trim();
    // Parse "1 of 6 people max"
    const match = text.match(/(\d+)\s+of\s+(\d+)/);
    if (!match) return { current: 0, max: 0 };
    
    console.log(`📊 Card player count: ${match[1]}/${match[2]}`);
    
    return {
      current: parseInt(match[1]),
      max: parseInt(match[2])
    };
  }

  // Save visited server
  function markServerAsVisited(serverId) {
    try {
      getVisitedServers().then((visited) => {
        visited[serverId] = {
          visitedAt: new Date().toISOString(),
          joinCount: (visited[serverId]?.joinCount || 0) + 1
        };
        try {
          chrome.storage.local.set({ [VISITED_SERVERS_KEY]: visited });
        } catch (error) {
          console.warn('⚠️ Could not save server:', error);
        }
      });
    } catch (error) {
      console.warn('⚠️ Extension context error:', error);
    }
  }

  // Get place ID from current URL
  function getPlaceId() {
    const gameMatch = window.location.href.match(/\/games\/(\d+)/);
    return gameMatch ? gameMatch[1] : null;
  }

  // Update card color based on whether its server is visited (synchronous)
  function updateCardColorSync(card, placeId, visitedServers) {
    try {
      // Get the server ID from the data-serverid attribute in the Share button
      const serverIdElement = card.querySelector('[data-serverid]');
      const serverId = serverIdElement?.getAttribute('data-serverid');

      if (serverId) {
        const fullId = `${placeId}_${serverId}`;
        if (visitedServers[fullId]) {
          card.classList.add('roblox-visited-server');
        } else {
          card.classList.remove('roblox-visited-server');
        }
      } else {
        card.classList.remove('roblox-visited-server');
      }
    } catch (error) {
      console.warn('⚠️ Error updating card color:', error);
    }
  }

  // Color a specific server card based on visit status
  async function colorServerCard(serverCard) {
    if (!serverCard) return;
    const placeId = getPlaceId();
    if (!placeId) return;
    
    const visited = await getVisitedServers();
    updateCardColorSync(serverCard, placeId, visited);
    console.log('🎨 Updated card color based on server visit status');
  }

  // Color all visited servers on page (can be called multiple times)
  async function colorVisitedServersOnPage() {
    try {
      const placeId = getPlaceId();
      if (!placeId) return;
      
      const visited = await getVisitedServers();
      const serverCards = document.querySelectorAll('.card-item:not(.card-item-friends-server):not(.card-item-private-server)');
      
      serverCards.forEach((card) => {
        // Extract the actual server ID from the card
        const serverIdElement = card.querySelector('[data-serverid]');
        const serverId = serverIdElement?.getAttribute('data-serverid');
        
        if (serverId) {
          const fullId = `${placeId}_${serverId}`;
          
          // Update the data attribute to store the actual server ID
          card.setAttribute('data-server-full-id', fullId);
          
          // Apply color based on visited status
          if (visited[fullId]) {
            card.classList.add('roblox-visited-server');
            card.classList.remove('roblox-just-joined');
          } else {
            card.classList.remove('roblox-visited-server');
            card.classList.remove('roblox-just-joined');
          }
        }
      });
      console.log('🎨 Colors updated on', serverCards.length, 'cards');
    } catch (error) {
      console.warn('⚠️ Extension context error:', error);
    }
  }

  // Watch for DOM changes and re-color servers
  function watchForServerChanges() {
    let recolorTimeout;
    
    const observer = new MutationObserver(() => {
      // Debounce to avoid excessive re-coloring
      clearTimeout(recolorTimeout);
      recolorTimeout = setTimeout(() => {
        console.log('👀 Change detected, re-coloring servers...');
        colorVisitedServersOnPage();
      }, 300);
    });

    // Watch the server list container for changes
    const gamesList = document.querySelector('[data-testid="games-carousel"]') || 
                      document.querySelector('.running-games-section') ||
                      document.body;
    
    observer.observe(gamesList, {
      childList: true,
      subtree: true,
      attributes: false
    });

    console.log('👁️ Server change watcher installed');
  }



  // Helper: Find the join button in a card
  function findJoinButton(card) {
    if (!card) return null;

    // Try specific button classes first
    let btn = card.querySelector('button.game-server-join-btn') ||
              card.querySelector('button.rbx-public-game-server-join');
    
    if (btn) return btn;

    // Fallback: find any button with "Join" text
    const buttons = card.querySelectorAll('button');
    for (let button of buttons) {
      if (button.textContent.trim() === 'Join') {
        return button;
      }
    }

    return null;
  }

  // Helper: Click join button with proper event handling
  function clickJoinButton(button) {
    if (!button) {
      console.warn('⚠️ No button provided');
      return;
    }

    try {
      // Method 1: Direct click
      button.click();
      console.log('✅ Button clicked (method 1)');
      
      // Method 2: Backup - trigger click event
      const clickEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      });
      button.dispatchEvent(clickEvent);
      console.log('✅ Button clicked (method 2)');
      
    } catch (error) {
      console.error('❌ Error clicking button:', error);
    }
  }

  // Hook into Join button clicks - use direct click handler
  function hookJoinButtons() {
    // Use event delegation on the document
    document.addEventListener('click', (e) => {
      // Get the button that was clicked
      let button = e.target.closest('button');
      
      if (!button) return;

      // Check if it's a join button (exclude friends/private server buttons)
      const card = button.closest('.card-item');
      if (!card) return;
      
      // Skip if it's a friends' or private server
      if (card.classList.contains('card-item-friends-server') || card.classList.contains('card-item-private-server')) {
        return;
      }

      let isJoinButton = button.classList.contains('game-server-join-btn') ||
                         button.classList.contains('rbx-public-game-server-join') ||
                         (button.textContent.trim() === 'Join' && card);

      if (!isJoinButton) return;

      console.log('✅ Join button clicked!');

      // Get server ID from Share link
      let shareLink = card.querySelector('[data-serverid]');
      let serverId = shareLink?.getAttribute('data-serverid');

      if (!serverId) {
        console.log('❌ Could not find server ID');
        return;
      }

      console.log('📍 Server ID:', serverId);

      // Get place ID from URL
      const placeId = getPlaceId();
      if (!placeId) {
        console.log('❌ Could not find place ID');
        return;
      }

      const fullId = `${placeId}_${serverId}`;

      // Color the card IMMEDIATELY
      colorServerCard(card);
      console.log('🎨 Card colored green');

      // Save it to storage
      markServerAsVisited(fullId);
      console.log('💾 Server saved to history');

    }, true); // Use capture phase to catch early
  }

  // Add "Join Random Server" button with settings
  function addRandomJoinButton() {
    // Only add button if we're on the game instances page
    const placeId = getPlaceId();
    console.log('🔍 addRandomJoinButton called, placeId:', placeId, 'hash:', window.location.hash);
    
    if (!placeId) {
      console.log('⚠️ Not on a game page, skipping button creation');
      return;
    }

    // Check if we're on the game instances page specifically
    const isGameInstancesPage = window.location.hash.includes('game-instances');
    console.log('📊 isGameInstancesPage:', isGameInstancesPage);
    
    if (!isGameInstancesPage) {
      console.log('⚠️ Not on game instances page (hash:', window.location.hash, '), skipping button creation');
      return;
    }

    console.log(`🎮 Game instances page detected, Place ID: ${placeId}`);

    const tryAdd = () => {
      // Check if button already exists
      if (document.getElementById('roblox-random-join-button')) {
        console.log('✅ Random Join button already exists');
        return true;
      }

      // Check if page is loaded - look for server-list-options
      const serverListOptions = document.querySelector('.server-list-options');
      if (!serverListOptions) {
        console.log('⏳ Page not ready yet, .server-list-options not found');
        return false;
      }

      console.log('🏗️ Creating button elements...');

      // Create button wrapper div
      const buttonWrapper = document.createElement('div');
      buttonWrapper.id = 'roblox-buttons-wrapper';
      buttonWrapper.style.cssText = `
        display: flex !important;
        gap: 8px !important;
        align-items: center !important;
        margin-left: 16px !important;
      `;

      // Random Join button
      const randomButton = document.createElement('button');
      randomButton.id = 'roblox-random-join-button';
      randomButton.textContent = 'Join Random';
      randomButton.type = 'button';
      randomButton.style.cssText = `
        padding: 8px 16px !important;
        background-color: #00b06f !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        font-family: 'Helvetica Neue', Arial, sans-serif !important;
        transition: all 0.2s ease !important;
        z-index: 100 !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
      `;

      randomButton.addEventListener('mouseover', () => {
        randomButton.style.backgroundColor = '#009058 !important';
        randomButton.style.transform = 'translateY(-2px) !important';
        randomButton.style.boxShadow = '0 4px 12px rgba(0, 176, 111, 0.3) !important';
      });

      randomButton.addEventListener('mouseout', () => {
        randomButton.style.backgroundColor = '#00b06f !important';
        randomButton.style.transform = 'translateY(0) !important';
        randomButton.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15) !important';
      });

      randomButton.addEventListener('click', handleJoinRandom);

      // Settings button
      const settingsButton = document.createElement('button');
      settingsButton.id = 'roblox-settings-button';
      settingsButton.textContent = '⚙️ Settings';
      settingsButton.type = 'button';
      settingsButton.title = 'Set max player count & sort options';
      settingsButton.style.cssText = `
        padding: 8px 16px !important;
        background-color: #FF6B6B !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        font-family: 'Helvetica Neue', Arial, sans-serif !important;
        transition: all 0.2s ease !important;
        z-index: 100 !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
      `;

      settingsButton.addEventListener('mouseover', () => {
        settingsButton.style.backgroundColor = '#FF5252 !important';
        settingsButton.style.transform = 'translateY(-2px) !important';
        settingsButton.style.boxShadow = '0 4px 12px rgba(255, 107, 107, 0.3) !important';
      });

      settingsButton.addEventListener('mouseout', () => {
        settingsButton.style.backgroundColor = '#FF6B6B !important';
        settingsButton.style.transform = 'translateY(0) !important';
        settingsButton.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15) !important';
      });

      settingsButton.addEventListener('click', showPlayerCountSettings);

      // Append buttons to wrapper
      buttonWrapper.appendChild(randomButton);
      buttonWrapper.appendChild(settingsButton);

      // Add to server-list-options container
      serverListOptions.appendChild(buttonWrapper);
      console.log('✅ Buttons added to .server-list-options');
      console.log('✅ Random Join button in DOM:', document.body.contains(randomButton));
      console.log('✅ Settings button in DOM:', document.body.contains(settingsButton));
      return true;
    };

    // Keep retrying until buttons are added or max attempts reached
    let attempts = 0;
    const retryInterval = setInterval(() => {
      const success = tryAdd();
      
      if (success) {
        console.log('✅ Button successfully placed, stopping retries');
        clearInterval(retryInterval);
        return;
      }
      
      attempts++;
      if (attempts >= 30) {
        clearInterval(retryInterval);
        console.log('⚠️ Could not add buttons after 30 attempts (15 seconds)');
      }
    }, 500); // Check every 500ms
  }

  // Show player count settings modal
  function showPlayerCountSettings() {
    // Prevent multiple modals
    if (document.getElementById('roblox-settings-modal-overlay')) {
      console.log('⚠️ Settings modal already open');
      return;
    }

    Promise.all([getMaxPlayersPreference(), getSortPreference(), getRefreshResetPreference()]).then(([currentMax, currentSort, refreshResetEnabled]) => {
      const playerOptions = [
        { label: 'No limit', value: 999 },
        { label: '5 players or less', value: 5 },
        { label: '4 players or less', value: 4 },
        { label: '3 players or less', value: 3 },
        { label: '2 players or less', value: 2 },
        { label: '1 player or less', value: 1 }
      ];

      const sortOptions = [
        { label: 'Ascending ↑', value: 'Asc' },
        { label: 'Descending ↓', value: 'Desc' }
      ];

      let playerHtml = '<div style="text-align: center; max-height: 200px; overflow-y: auto;">';
      playerOptions.forEach(opt => {
        const isSelected = opt.value === currentMax;
        playerHtml += `<button class="settings-player-btn" data-value="${opt.value}" style="display: block; width: 100%; padding: 12px; margin: 5px 0; border: 2px solid ${isSelected ? '#00b06f' : '#d0d0d0'}; background-color: ${isSelected ? '#00b06f' : '#f5f5f5'}; color: ${isSelected ? 'white' : '#000'}; cursor: pointer; border-radius: 3px; font-size: 14px; font-weight: ${isSelected ? 'bold' : 'normal'}; transition: all 0.2s;">${isSelected ? '✓ ' : ''}${opt.label}</button>`;
      });
      playerHtml += '</div>';

      let sortHtml = '<div style="display: flex; gap: 10px; justify-content: center;">';
      sortOptions.forEach(opt => {
        const isSelected = opt.value === currentSort;
        sortHtml += `<button class="settings-sort-btn" data-value="${opt.value}" style="flex: 1; padding: 12px; border: 2px solid ${isSelected ? '#00b06f' : '#d0d0d0'}; background-color: ${isSelected ? '#00b06f' : '#f5f5f5'}; color: ${isSelected ? 'white' : '#000'}; cursor: pointer; border-radius: 3px; font-size: 14px; font-weight: ${isSelected ? 'bold' : 'normal'}; transition: all 0.2s;">${isSelected ? '✓ ' : ''}${opt.label}</button>`;
      });
      sortHtml += '</div>';

      // Create overlay
      const overlay = document.createElement('div');
      overlay.id = 'roblox-settings-modal-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 10000;
      `;

      const modal = document.createElement('div');
      modal.id = 'roblox-settings-modal';
      modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: #FFFFFF;
        border: 3px solid #FF6B6B;
        border-radius: 12px;
        padding: 25px;
        z-index: 10001;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        max-width: 360px;
        font-family: Arial, sans-serif;
      `;

      modal.innerHTML = `
        <h3 style="margin-top: 0; text-align: center; color: #000; font-size: 18px;">⚙️ Extension Settings</h3>
        
        <p style="text-align: center; color: #000; font-size: 13px; margin-bottom: 10px; margin-top: 15px; font-weight: bold;">Max Player Count</p>
        <p style="text-align: center; color: #666; font-size: 12px; margin-bottom: 10px;">Select the maximum player count for servers you want to join</p>
        <div id="player-options" style="text-align: center; max-height: 200px; overflow-y: auto;">
          ${playerOptions.map(opt => {
            const isSelected = opt.value === currentMax;
            return `<button class="settings-player-btn" data-value="${opt.value}" style="display: block; width: 100%; padding: 12px; margin: 5px 0; border: 2px solid ${isSelected ? '#00b06f' : '#d0d0d0'}; background-color: ${isSelected ? '#00b06f' : '#f5f5f5'}; color: ${isSelected ? 'white' : '#000'}; cursor: pointer; border-radius: 3px; font-size: 14px; font-weight: ${isSelected ? 'bold' : 'normal'}; transition: all 0.2s;">${isSelected ? '✓ ' : ''}${opt.label}</button>`;
          }).join('')}
        </div>

        <p style="text-align: center; color: #000; font-size: 13px; margin-bottom: 10px; margin-top: 20px; font-weight: bold;">Preferred Sort Order</p>
        <p style="text-align: center; color: #666; font-size: 12px; margin-bottom: 10px;">Choose how servers should be sorted when random hopping</p>
        <div id="sort-options" style="display: flex; gap: 10px; justify-content: center;">
          ${sortOptions.map(opt => {
            const isSelected = opt.value === currentSort;
            return `<button class="settings-sort-btn" data-value="${opt.value}" style="flex: 1; padding: 12px; border: 2px solid ${isSelected ? '#00b06f' : '#d0d0d0'}; background-color: ${isSelected ? '#00b06f' : '#f5f5f5'}; color: ${isSelected ? 'white' : '#000'}; cursor: pointer; border-radius: 3px; font-size: 14px; font-weight: ${isSelected ? 'bold' : 'normal'}; transition: all 0.2s;">${isSelected ? '✓ ' : ''}${opt.label}</button>`;
          }).join('')}
        </div>

        <p style="text-align: center; color: #000; font-size: 13px; margin-bottom: 10px; margin-top: 20px; font-weight: bold;">Refresh Behavior</p>
        <p style="text-align: center; color: #666; font-size: 12px; margin-bottom: 10px;">When Refresh is clicked, should the server highlight reset?</p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button class="settings-refresh-btn" data-value="true" style="flex: 1; padding: 12px; border: 2px solid ${refreshResetEnabled ? '#00b06f' : '#d0d0d0'}; background-color: ${refreshResetEnabled ? '#00b06f' : '#f5f5f5'}; color: ${refreshResetEnabled ? 'white' : '#000'}; cursor: pointer; border-radius: 3px; font-size: 14px; font-weight: ${refreshResetEnabled ? 'bold' : 'normal'}; transition: all 0.2s;">${refreshResetEnabled ? '✓ ' : ''}Reset</button>
          <button class="settings-refresh-btn" data-value="false" style="flex: 1; padding: 12px; border: 2px solid ${!refreshResetEnabled ? '#00b06f' : '#d0d0d0'}; background-color: ${!refreshResetEnabled ? '#00b06f' : '#f5f5f5'}; color: ${!refreshResetEnabled ? 'white' : '#000'}; cursor: pointer; border-radius: 3px; font-size: 14px; font-weight: ${!refreshResetEnabled ? 'bold' : 'normal'}; transition: all 0.2s;">${!refreshResetEnabled ? '✓ ' : ''}Keep</button>
        </div>

        <button id="close-settings" style="display: block; width: 100%; padding: 12px; margin-top: 20px; background-color: #333333; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: 600; font-size: 14px;">✕ Close</button>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(modal);

      // Add event listeners for player options
      modal.querySelectorAll('.settings-player-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          const value = parseInt(this.getAttribute('data-value'));
          setMaxPlayersPreference(value);
          console.log('💾 Max players saved:', value);
          
          // Update UI
          modal.querySelectorAll('.settings-player-btn').forEach(b => {
            const selected = b === this;
            b.style.borderColor = selected ? '#00b06f' : '#d0d0d0';
            b.style.backgroundColor = selected ? '#00b06f' : '#f5f5f5';
            b.style.color = selected ? 'white' : '#000';
            b.style.fontWeight = selected ? 'bold' : 'normal';
            if (selected && !b.textContent.startsWith('✓')) {
              b.textContent = '✓ ' + b.textContent;
            } else if (!selected && b.textContent.startsWith('✓')) {
              b.textContent = b.textContent.substring(2);
            }
          });
        });
      });

      // Add event listeners for sort options
      modal.querySelectorAll('.settings-sort-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          const value = this.getAttribute('data-value');
          setSortPreference(value);
          console.log('💾 Sort order saved:', value);
          
          // Update UI
          modal.querySelectorAll('.settings-sort-btn').forEach(b => {
            const selected = b === this;
            b.style.borderColor = selected ? '#00b06f' : '#d0d0d0';
            b.style.backgroundColor = selected ? '#00b06f' : '#f5f5f5';
            b.style.color = selected ? 'white' : '#000';
            b.style.fontWeight = selected ? 'bold' : 'normal';
            if (selected && !b.textContent.startsWith('✓')) {
              b.textContent = '✓ ' + b.textContent;
            } else if (!selected && b.textContent.startsWith('✓')) {
              b.textContent = b.textContent.substring(2);
            }
          });
        });
      });

      // Add event listeners for refresh reset options
      modal.querySelectorAll('.settings-refresh-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          const value = this.getAttribute('data-value') === 'true';
          setRefreshResetPreference(value);
          console.log('💾 Refresh reset preference saved:', value);
          
          // Update UI
          modal.querySelectorAll('.settings-refresh-btn').forEach(b => {
            const selected = b === this;
            b.style.borderColor = selected ? '#00b06f' : '#d0d0d0';
            b.style.backgroundColor = selected ? '#00b06f' : '#f5f5f5';
            b.style.color = selected ? 'white' : '#000';
            b.style.fontWeight = selected ? 'bold' : 'normal';
            if (selected && !b.textContent.startsWith('✓')) {
              b.textContent = '✓ ' + b.textContent;
            } else if (!selected && b.textContent.startsWith('✓')) {
              b.textContent = b.textContent.substring(2);
            }
          });
        });
      });

      // Close button
      modal.querySelector('#close-settings').addEventListener('click', function(e) {
        e.preventDefault();
        overlay.remove();
        modal.remove();
        console.log('✅ Settings closed and saved');
      });

      // Close on outside click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          modal.remove();
          console.log('✅ Settings closed');
        }
      });
    });
  }

  // Handle random server join with smart sort/filter and visual feedback
  async function handleJoinRandom() {
    try {
      console.log('🎯 Join Random Server clicked!');
      
      const visited = await getVisitedServers();
      const maxPlayersLimit = await getMaxPlayersPreference();
      const userSortPref = await getSortPreference();
      
      console.log('👥 Max players filter:', maxPlayersLimit === 999 ? 'No limit' : maxPlayersLimit);
      console.log('📊 Sort preference:', userSortPref);
      
      const placeId = getPlaceId();
      if (!placeId) {
        alert('Please navigate to a Roblox game page first');
        return;
      }

      console.log('🎮 Place ID:', placeId);

      // Smart sort/filter: only apply if not already in desired state
      await applySortPreference(userSortPref);

      // Wait a bit for sort to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // Get all PUBLIC server cards (exclude friends' and private servers)
      let allCards = Array.from(
        document.querySelectorAll('.card-item:not(.card-item-friends-server):not(.card-item-private-server)')
      );
      console.log('📊 Found', allCards.length, 'public server cards on page');

      if (allCards.length === 0) {
        alert('No public servers visible. Scroll down to load more.');
        return;
      }

      // Try to find valid unvisited servers (match all filters)
      let validCards = allCards.filter(card => {
        const shareLink = card.querySelector('[data-serverid]');
        const serverId = shareLink?.getAttribute('data-serverid');
        if (!serverId) return false;
        
        const fullId = `${placeId}_${serverId}`;
        if (visited[fullId]) return false;

        const { current, max } = getPlayerCountFromCard(card);
        if (current >= max) {
          console.log(`⏭️ Skipping full server: ${current}/${max}`);
          return false;
        }
        if (current > maxPlayersLimit) {
          console.log(`⏭️ Skipping server with too many players: ${current} > ${maxPlayersLimit} (${current}/${max})`);
          return false;
        }
        
        return true;
      });

      console.log(`✓ Found ${validCards.length} valid servers that match filters`);

      if (validCards.length > 0) {
        const selected = validCards[Math.floor(Math.random() * validCards.length)];
        const { current, max } = getPlayerCountFromCard(selected);
        console.log(`🎲 Selected valid server: ${current}/${max} players`);
        
        const btn = findJoinButton(selected);
        if (btn) {
          console.log('🚀 Joining server...');
          await highlightJoinedServer(selected);
          // Mark as visited before joining
          const shareLink = selected.querySelector('[data-serverid]');
          const serverId = shareLink?.getAttribute('data-serverid');
          if (serverId && placeId) {
            markServerAsVisited(`${placeId}_${serverId}`);
          }
          clickJoinButton(btn);
          return;
        } else {
          console.warn('⚠️ Could not find join button in card');
        }
      }

      // No valid servers - try unvisited only (ignore filters)
      let unvisited = allCards.filter(card => {
        const shareLink = card.querySelector('[data-serverid]');
        const serverId = shareLink?.getAttribute('data-serverid');
        if (!serverId) return false;
        
        const fullId = `${placeId}_${serverId}`;
        if (visited[fullId]) return false;
        
        // Still apply max players filter even in fallback
        const { current, max } = getPlayerCountFromCard(card);
        if (current >= max) return false; // Skip full
        if (current > maxPlayersLimit) return false; // Skip over limit
        
        return true;
      });

      if (unvisited.length > 0) {
        console.log('⚠️ No perfect matches, joining unvisited server with filter applied');
        const selected = unvisited[Math.floor(Math.random() * unvisited.length)];
        const { current, max } = getPlayerCountFromCard(selected);
        console.log(`🎲 Selected unvisited server: ${current}/${max} players (Max limit: ${maxPlayersLimit})`);
        
        const btn = findJoinButton(selected);
        if (btn) {
          console.log('🚀 Joining server...');
          await highlightJoinedServer(selected);
          // Mark as visited before joining
          const shareLink = selected.querySelector('[data-serverid]');
          const serverId = shareLink?.getAttribute('data-serverid');
          if (serverId && placeId) {
            markServerAsVisited(`${placeId}_${serverId}`);
          }
          clickJoinButton(btn);
          return;
        } else {
          console.warn('⚠️ Could not find join button in card');
        }
      }

      // All visible servers visited - load more
      console.log('📥 All visible servers visited, loading more...');
      await autoLoadAndJoinIfAllVisited();
    } catch (error) {
      console.error('❌ Error:', error);
      alert('Error: ' + error.message);
    }
  }

  // Smart sort preference application - only if needed
  async function applySortPreference(userSort) {
    try {
      const sortSelect = document.querySelector('#sort-select');
      if (!sortSelect) {
        console.warn('⚠️ Sort selector not found');
        return;
      }

      const currentSort = sortSelect.value;
      console.log(`🔄 Current sort: ${currentSort}, Preferred: ${userSort}`);

      // Only change if different
      if (currentSort !== userSort) {
        console.log(`↔️ Changing sort from ${currentSort} to ${userSort}`);
        
        // Store the current visited servers before sorting
        const placeId = getPlaceId();
        const visited = await getVisitedServers();
        
        // Change sort
        sortSelect.value = userSort;
        
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        sortSelect.dispatchEvent(event);
        
        // Wait for DOM to update after sort
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Re-apply highlighting based on stored visit data (using server IDs, not positions)
        colorVisitedServersOnPage();
        
        console.log('✓ Sort applied and highlights refreshed based on server IDs');
      } else {
        console.log('✓ Sort is already correct');
      }
    } catch (error) {
      console.warn('⚠️ Could not apply sort preference:', error);
    }
  }

  // Visual highlight for newly joined server - persistent and based on server ID
  async function highlightJoinedServer(serverCard) {
    try {
      const placeId = getPlaceId();
      if (!placeId) return;
      
      // Extract the actual server ID from the card
      const serverIdElement = serverCard.querySelector('[data-serverid]');
      const serverId = serverIdElement?.getAttribute('data-serverid');
      
      if (serverId) {
        const fullId = `${placeId}_${serverId}`;
        // Store the actual server ID on the card
        serverCard.setAttribute('data-server-full-id', fullId);
        // Add permanent highlight class
        serverCard.classList.add('roblox-just-joined');
        console.log(`✨ Server ${fullId} highlighted permanently`);
      }
    } catch (error) {
      console.warn('⚠️ Could not highlight server:', error);
    }
  }

  // Check if all visible servers are visited, and auto-load/join if needed
  async function autoLoadAndJoinIfAllVisited() {
    // Prevent multiple auto-loads running at the same time
    if (isAutoLoadInProgress) {
      console.log('⏳ Auto-load already in progress, skipping...');
      return;
    }

    try {
      isAutoLoadInProgress = true;
      
      const placeId = getPlaceId();
      if (!placeId) return;

      const visited = await getVisitedServers();
      const allCards = Array.from(
        document.querySelectorAll('.card-item:not(.card-item-friends-server):not(.card-item-private-server)')
      );

      if (allCards.length === 0) {
        isAutoLoadInProgress = false;
        return;
      }

      // Check if all visible servers are visited by checking server IDs
      const allVisited = allCards.every(card => {
        const shareLink = card.querySelector('[data-serverid]');
        const serverId = shareLink?.getAttribute('data-serverid');
        if (!serverId) return false;
        
        const fullId = `${placeId}_${serverId}`;
        return visited[fullId];
      });

      if (!allVisited) {
        console.log('✓ Found unvisited servers, no need to load more');
        isAutoLoadInProgress = false;
        return;
      }

      console.log('⏳ All visible servers visited, attempting to load more...');
      
      // Find and click the Load More button
      const loadMoreBtn = document.querySelector('.rbx-running-games-load-more');
      if (!loadMoreBtn) {
        console.log('⚠️ Load More button not found');
        isAutoLoadInProgress = false;
        return;
      }

      loadMoreBtn.click();
      console.log('📥 Clicked Load More');

      // Wait for new servers to load
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 800));

        const updatedCards = Array.from(
          document.querySelectorAll('.card-item:not(.card-item-friends-server):not(.card-item-private-server)')
        );
        const updatedVisited = await getVisitedServers();
        const maxPlayersLimit = await getMaxPlayersPreference();

        // Find first unvisited server based on server ID and apply max players filter
        const unvisitedCard = updatedCards.find(card => {
          const shareLink = card.querySelector('[data-serverid]');
          const serverId = shareLink?.getAttribute('data-serverid');
          if (!serverId) return false;
          
          const fullId = `${placeId}_${serverId}`;
          if (updatedVisited[fullId]) return false;

          // Also apply max players filter
          const { current, max } = getPlayerCountFromCard(card);
          if (current >= max) return false; // Skip full
          if (current > maxPlayersLimit) return false; // Skip over limit
          
          return true;
        });

        if (unvisitedCard) {
          console.log('🎲 Found unvisited server after loading');
          const { current, max } = getPlayerCountFromCard(unvisitedCard);
          console.log(`📊 Server has ${current}/${max} players (Max limit: ${maxPlayersLimit})`);
          
          const btn = findJoinButton(unvisitedCard);
          if (btn) {
            console.log('🚀 ACTUALLY JOINING unvisited server...');
            await highlightJoinedServer(unvisitedCard);
            // Mark as visited before joining
            const shareLink = unvisitedCard.querySelector('[data-serverid]');
            const serverId = shareLink?.getAttribute('data-serverid');
            if (serverId && placeId) {
              markServerAsVisited(`${placeId}_${serverId}`);
            }
            clickJoinButton(btn);
            isAutoLoadInProgress = false;
            return;
          } else {
            console.warn('⚠️ Could not find join button in auto-load server');
          }
        }
      }

      console.log('⚠️ Could not find unvisited server after loading more');
      isAutoLoadInProgress = false;
    } catch (error) {
      console.warn('⚠️ Auto-load error:', error);
      isAutoLoadInProgress = false;
    }
  }

  // Monitor if all visible servers are visited and auto-load
  function setupAutoLoadWatcher() {
    // Check every 2 seconds if all servers are visited
    setInterval(async () => {
      try {
        // Don't interfere if a manual auto-load is in progress
        if (isAutoLoadInProgress) {
          console.log('⏳ Auto-load already in progress, skipping watcher check');
          return;
        }

        const placeId = getPlaceId();
        if (!placeId) return;

        const visited = await getVisitedServers();
        const allCards = Array.from(
          document.querySelectorAll('.card-item:not(.card-item-friends-server):not(.card-item-private-server)')
        );

        if (allCards.length === 0) return;

        // Check if all visible servers are visited based on server IDs
        const allVisited = allCards.every(card => {
          const shareLink = card.querySelector('[data-serverid]');
          const serverId = shareLink?.getAttribute('data-serverid');
          if (!serverId) return false;
          
          const fullId = `${placeId}_${serverId}`;
          return visited[fullId];
        });

        if (allVisited) {
          console.log('🔄 All visible servers visited, initiating auto-load');
          await autoLoadAndJoinIfAllVisited();
        }
      } catch (error) {
        // Silent fail for interval
      }
    }, 2000);

    console.log('🔔 Auto-load watcher installed');
  }

  // Auto-hop on key press (hold Shift key for 2 seconds)
  function setupAutoHop() {
    let shiftHeldTime = 0;
    
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && !shiftHeldTime) {
        shiftHeldTime = Date.now();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!e.shiftKey) {
        // If shift was held for 2+ seconds, trigger auto-hop
        if (shiftHeldTime && Date.now() - shiftHeldTime >= 2000) {
          console.log('⏱️ Auto-hop triggered!');
          handleJoinRandom();
        }
        shiftHeldTime = 0;
      }
    });
  }

  // Setup refresh button handler
  function setupRefreshButton() {
    // Wait a bit for the page to load the refresh button
    setTimeout(() => {
      const refreshBtn = document.querySelector('.rbx-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
          console.log('🔄 Refresh button clicked');
          
          // Always clear the visited servers array when refresh is clicked
          chrome.storage.local.set({ [VISITED_SERVERS_KEY]: {} });
          console.log('🗑️ Visited servers array cleared');
          
          // Get the refresh reset preference
          const shouldReset = await getRefreshResetPreference();
          
          if (shouldReset) {
            console.log('♻️ Resetting visual highlights...');
            
            // Wait a bit for the page to update after refresh
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Clear the "just joined" highlights from all cards
            const allCards = document.querySelectorAll('.roblox-just-joined');
            allCards.forEach(card => {
              card.classList.remove('roblox-just-joined');
            });
            
            // Re-apply highlights based on visited servers (green border only)
            colorVisitedServersOnPage();
            
            console.log('✅ Visual highlights reset');
          } else {
            console.log('✨ Keeping visual highlights');
          }
        });
      } else {
        console.log('⚠️ Refresh button not found');
      }
    }, 500);
  }

  // Initialize
  function initializeExtension() {
    console.log('🚀 Roblox Server Hopper initialized');
    console.log('📍 Current URL:', window.location.href);
    console.log('🏷️ Hash:', window.location.hash);
    
    // Inject CSS first
    injectCSS();
    
    // Color any visited servers on load
    colorVisitedServersOnPage();

    // Watch for server list changes (sorting, load more, etc.)
    watchForServerChanges();

    // Hook into join clicks
    hookJoinButtons();

    // Add random join button (try multiple times on initialization)
    addRandomJoinButton();
    
    // Monitor hash changes and re-add button if hash changes to game-instances
    window.addEventListener('hashchange', () => {
      console.log('🔗 Hash changed to:', window.location.hash);
      addRandomJoinButton();
    });

    // Setup auto-hop on key press
    setupAutoHop();

    // Setup refresh button handler
    setupRefreshButton();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
  } else {
    initializeExtension();
  }

})();
