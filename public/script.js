const API_BASE = '/api';

// State
let currentMode = 'auto';
let refreshInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSystemStatus();
    loadLatestData();
    loadHistoryData();
    
    // Auto-refresh every 5 seconds
    refreshInterval = setInterval(() => {
        loadLatestData();
        loadHistoryData();
    }, 5000);
});

// Load system status and update UI
async function loadSystemStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const result = await response.json();
        
        if (result.success && result.data) {
            currentMode = result.data.mode || 'auto';
            updateModeButtons(currentMode);
        }
    } catch (error) {
        console.error('Error loading status:', error);
    }
}

// Update mode buttons
function updateModeButtons(mode) {
    const btnAuto = document.getElementById('btnAuto');
    const btnManual = document.getElementById('btnManual');
    const chillerControl = document.getElementById('chillerControl');
    
    if (mode === 'auto') {
        btnAuto.classList.add('active');
        btnManual.classList.remove('active');
        chillerControl.style.display = 'none'; // Hide chiller control in auto mode
    } else {
        btnAuto.classList.remove('active');
        btnManual.classList.add('active');
        chillerControl.style.display = 'flex'; // Show chiller control in manual mode
    }
    
    // Update current mode display
    document.getElementById('currentMode').textContent = mode.toUpperCase();
}

// Set mode (auto/manual)
async function setMode(mode) {
    try {
        const response = await fetch(`${API_BASE}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mode })
        });
        
        // Check if response is ok before parsing
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
            }
            console.error('HTTP Error:', response.status, errorData);
            showNotification('Error updating mode: ' + (errorData.error || 'Unknown error'), 'error');
            return;
        }
        
        const result = await response.json();
        
        if (result.success) {
            currentMode = mode;
            updateModeButtons(mode);
            console.log(`Mode changed to: ${mode}`);
            
            // Reload system status to ensure we have the latest data
            await loadSystemStatus();
            
            // Show success message
            showNotification(`Mode changed to ${mode.toUpperCase()}`, 'success');
        } else {
            console.error('Error response:', result);
            showNotification('Error updating mode: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error setting mode:', error);
        showNotification('Error updating mode. Please try again.', 'error');
    }
}

// Control chiller (ON/OFF) - only works in manual mode
async function controlChiller(action) {
    try {
        const response = await fetch(`${API_BASE}/chiller/control`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action })
        });
        
        // Check if response is ok before parsing
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
            }
            console.error('HTTP Error:', response.status, errorData);
            showNotification('Error: ' + (errorData.error || 'Unknown error'), 'error');
            return;
        }
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`Chiller ${action} command sent`, 'success');
            console.log(`Chiller ${action} command sent`);
        } else {
            showNotification('Error: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error controlling chiller:', error);
        showNotification('Error sending chiller command. Please try again.', 'error');
    }
}

// Show notification
function showNotification(message, type) {
    // Remove existing notification if any
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#4ade80' : '#ef4444'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 1000;
        font-weight: 600;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Load latest sensor data
async function loadLatestData() {
    try {
        const response = await fetch(`${API_BASE}/logs/latest`);
        const result = await response.json();
        
        if (result.success && result.data) {
            const data = result.data;
            
            // Update current readings (convert to numbers if strings)
            document.getElementById('currentLDR').textContent = data.ldr_value || '-';
            const voltage = data.battery_voltage ? parseFloat(data.battery_voltage) : null;
            const temp = data.temperature ? parseFloat(data.temperature) : null;
            document.getElementById('currentVoltage').textContent = 
                voltage !== null ? `${voltage.toFixed(2)} V` : '-';
            document.getElementById('currentTemp').textContent = 
                temp !== null ? `${temp.toFixed(2)} °C` : '-';
            
            // Update last updated time
            if (data.record_date && data.record_time) {
                const dateStr = formatDate(data.record_date);
                document.getElementById('lastUpdated').textContent = 
                    `${dateStr} ${data.record_time}`;
            }
        }
    } catch (error) {
        console.error('Error loading latest data:', error);
    }
}

// Load history data
async function loadHistoryData() {
    try {
        const response = await fetch(`${API_BASE}/logs?limit=50`);
        const result = await response.json();
        
        if (result.success && result.data) {
            displayHistoryTable(result.data);
        }
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyBody').innerHTML = 
            '<tr><td colspan="7" class="loading">Error loading data</td></tr>';
    }
}

// Display history table
function displayHistoryTable(data) {
    const tbody = document.getElementById('historyBody');
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">No data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(row => {
        const dateStr = formatDate(row.record_date);
        const chillerStatus = getChillerStatus(row);
        const state = getStateFromData(row);
        
        // Convert to numbers if they're strings
        const voltage = row.battery_voltage ? parseFloat(row.battery_voltage) : null;
        const temp = row.temperature ? parseFloat(row.temperature) : null;
        
        return `
            <tr>
                <td>${dateStr}</td>
                <td>${row.record_time || '-'}</td>
                <td>${row.ldr_value || '-'}</td>
                <td>${voltage !== null ? voltage.toFixed(2) : '-'}</td>
                <td>${temp !== null ? temp.toFixed(2) : '-'}</td>
                <td>${chillerStatus}</td>
                <td>${state}</td>
            </tr>
        `;
    }).join('');
}

// Format date from YYYY-MM-DD to DD-MM-YYYY
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
}

// Get chiller status
function getChillerStatus(row) {
    if (!row.chiller) return '<span class="chiller-off"><span class="chiller-dot off"></span>OFF</span>';
    const isOn = row.chiller.toUpperCase() === 'ON';
    const className = isOn ? 'chiller-on' : 'chiller-off';
    const dotClass = isOn ? 'on' : 'off';
    return `<span class="${className}"><span class="chiller-dot ${dotClass}"></span>${row.chiller}</span>`;
}

// Get state from data
function getStateFromData(row) {
    if (!row.state) return '<span class="state-badge">-</span>';
    return `<span class="state-badge">${row.state}</span>`;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});

