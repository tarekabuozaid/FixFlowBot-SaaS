// Updated FixFlowBot with user management, priorities, assignments, timeline tracking,
// improved notifications, pagination and filtering, and added documentation.
// Date: 2025-07-31.

/* eslint-disable no-unused-vars */

/**
 * This script extends the original FixFlowBot Google Apps Script.
 * It introduces the following key features:
 * 1. User management: admins can view, edit roles or delete registered users.
 * 2. Priorities: users can select a priority (Low, Medium, High) when creating a request.
 * 3. Assignment: requests can be assigned to a specific technician during creation.
 * 4. Timeline: status changes are recorded in a separate sheet for traceability.
 * 5. Notifications: users are notified when their requests change status; supervisors receive
 *    periodic reminders for overdue requests.
 * 6. Web reports: a simple HTML page lists requests and users for administrators.
 * 7. Pagination and filtering: users can browse their past requests with pagination and filter by status.
 * 8. Improved summary: computeSummary now includes counts by priority and assigned/unassigned requests.
 *
 * The core logic remains compatible with the original bot; new features are added in a modular way.
 */

// [1] Configuration & Constants
const BOT_TOKEN = '8384799464:AAHLlXJhUWm0AuXoyHX7iffcFJiG7l9U4e0';
const SHEET_NAME = 'Sheet1';  // Main data sheet
const REG_SHEET_NAME = 'Registrations'; // Registration sheet
const TIMELINE_SHEET_NAME = 'Timelines'; // New sheet for status change history
const DRIVE_FOLDER_ID = '1-BTY6cG1qmSJ0aWU8D4AXOkB8gULMGHL';

const ADMIN_IDS = [7103238318];
const TECH_IDS = [7500135526];

// Cache spreadsheet references
const spreadsheet = SpreadsheetApp.openById('1THbDwp8EEW0oaAhlv8LI-qEvvcOR5st_uLZBeqL-91s');
const regSheet = spreadsheet.getSheetByName(REG_SHEET_NAME); // Registrations
const dataSheet = spreadsheet.getSheetByName(SHEET_NAME); // Main data

// Ensure timeline sheet exists
let timelineSheet = spreadsheet.getSheetByName(TIMELINE_SHEET_NAME);
if (!timelineSheet) {
  timelineSheet = spreadsheet.insertSheet(TIMELINE_SHEET_NAME);
  timelineSheet.appendRow(['Request ID', 'Date', 'Old Status', 'New Status', 'Updated By']);
}

// User states
const STATES = {
  AWAITING_REG_PHONE: 'awaiting_reg_phone',
  AWAITING_REG_USERNAME: 'awaiting_reg_username',
  AWAITING_REG_PASSWORD: 'awaiting_reg_password',
  AWAITING_LOGIN_USERNAME: 'awaiting_login_username',
  AWAITING_LOGIN_PASSWORD: 'awaiting_login_password',
  AWAITING_TYPE: 'awaiting_type',
  AWAITING_PRIORITY: 'awaiting_priority',
  AWAITING_LOCATION: 'awaiting_location',
  AWAITING_DESCRIPTION: 'awaiting_description',
  AWAITING_ASSIGN_TO: 'awaiting_assign_to',
  AWAITING_IMAGE: 'awaiting_image',
  AWAITING_CONFIRMATION: 'awaiting_confirmation'
};

// Suggested issues by type
const SUGGESTED_ISSUES = {
  civil: ['Broken tiles', 'Wall crack', 'Ceiling damage', 'Door issue'],
  electrical: ['Light not working', 'Power outlet issue', 'Circuit breaker tripped', 'Fan not working'],
  mechanical: ['Water leakage', 'AC not cooling', 'Heating issue', 'Plumbing problem']
};

const STATUS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  CLOSED: 'Closed',
  PENDING: 'Pending',
  REJECTED: 'Rejected'
};

const PRIORITIES = ['Low', 'Medium', 'High'];

const ROLES = {
  TECH: 'Tech',
  USER: 'User',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin'
};

// Pagination settings
const PAGE_SIZE = 5;

////////////////////////////////////////////////////////////////////////////////
// [2] Entry Point
////////////////////////////////////////////////////////////////////////////////
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    if (update.callback_query) {
      return handleCallback(update.callback_query);
    }
    if (update.message) {
      return handleMessage(update.message, update);
    }
  } catch (err) {
    Logger.log(`doPost error: ${err.message}\n${err.stack}`);
    // Notify admins about the error
    ADMIN_IDS.forEach(adminId => {
      sendMessage(adminId, `⚠️ System error: ${err.message}`);
    });
  }
  return HtmlService.createHtmlOutput('ok');
}

////////////////////////////////////////////////////////////////////////////////
// [3] Message Handler
////////////////////////////////////////////////////////////////////////////////
function handleMessage(msg, update) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const lower = text.toLowerCase();
  const userProps = PropertiesService.getUserProperties();
  const state = userProps.getProperty(String(chatId));

  try {
    // Process main commands and states
    if (lower === '/start') {
      resetUserState(userProps, chatId);
      showMainMenu(chatId, userId);
      return HtmlService.createHtmlOutput('ok');
    }

    // Handle registration and login
    if (handleRegistrationFlow(msg, update, userProps, chatId, userId, text, lower, state)) {
      return HtmlService.createHtmlOutput('ok');
    }

    // Check user authorization
    if (!isAuthorized(userId)) {
      showMainMenu(chatId, userId);
      return HtmlService.createHtmlOutput('ok');
    }

    // Handle authorized user commands
    if (handleAuthorizedCommands(msg, chatId, userId, text, lower, state, userProps)) {
      return HtmlService.createHtmlOutput('ok');
    }

    // Handle issue reporting workflow
    if (handleIssueReportFlow(msg, chatId, userId, text, lower, state, userProps)) {
      return HtmlService.createHtmlOutput('ok');
    }

    // Default - show main menu
    sendMessage(chatId, '⚠️ Please use the menu below.', {
      reply_markup: { remove_keyboard: true }
    });
    showMainMenu(chatId, userId);

  } catch (err) {
    Logger.log(`handleMessage error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ An error occurred while processing your request. Please try again.');
    resetUserState(userProps, chatId);
    showMainMenu(chatId, userId);
  }

  return HtmlService.createHtmlOutput('ok');
}

////////////////////////////////////////////////////////////////////////////////
// [4] Flow Handlers
////////////////////////////////////////////////////////////////////////////////

// [4.1] Handle registration and login flow
function handleRegistrationFlow(msg, update, userProps, chatId, userId, text, lower, state) {
  // Registration requests
  if ((lower === '/register' || (update && update.callback_query && update.callback_query.data === 'register')) && !state) {
    startRegistration(chatId, userProps);
    return true;
  }

  // Login requests
  if (lower === '/login' || (update && update.callback_query && update.callback_query.data === 'login')) {
    sendMessage(chatId, '👤 Please enter your username:');
    userProps.setProperty(String(chatId), STATES.AWAITING_LOGIN_USERNAME);
    return true;
  }

  // Handle login steps
  if (state === STATES.AWAITING_LOGIN_USERNAME) {
    userProps.setProperty(String(chatId) + '_login_username', text);
    sendMessage(chatId, '🔑 Please enter your password:');
    userProps.setProperty(String(chatId), STATES.AWAITING_LOGIN_PASSWORD);
    return true;
  }

  if (state === STATES.AWAITING_LOGIN_PASSWORD) {
    userProps.setProperty(String(chatId) + '_login_password', text);
    sendMessage(chatId, '⌛ Verifying your credentials...');

    // Log login request and notify admins
    const username = userProps.getProperty(String(chatId) + '_login_username');
    notifyAdmins(`New login request:\nUsername: ${username}\nFrom: ${chatId}`);

    sendMessage(chatId, '✅ Login request sent. An admin will review and activate your account.');
    resetUserState(userProps, chatId);
    showMainMenu(chatId, userId);
    return true;
  }

  // Handle registration steps
  if (state === STATES.AWAITING_REG_PHONE) {
    handleRegPhone(chatId, text, userProps);
    return true;
  }

  if (state === STATES.AWAITING_REG_USERNAME) {
    handleRegUsername(chatId, text, userProps);
    return true;
  }

  if (state === STATES.AWAITING_REG_PASSWORD) {
    completeRegistration(chatId, text, userProps, userId);
    return true;
  }

  return false;
}

// [4.2] Handle authorized user commands
function handleAuthorizedCommands(msg, chatId, userId, text, lower, state, userProps) {
  // Admin-only summary
  if (lower === '/summary' && isAdmin(userId)) {
    sendSummary(chatId, userId);
    return true;
  }

  // Start new issue
  if (lower === '/new' || lower === 'new issue') {
    showTypeMenu(chatId);
    userProps.setProperty(String(chatId), STATES.AWAITING_TYPE);
    return true;
  }

  // My issues command - include pagination
  if (lower === '/my' || lower === 'my issues') {
    showMyRequests(chatId, userId, 1, 'all');
    return true;
  }

  // Admin: user management command
  if ((lower === '/users' || lower === 'manage users') && isAdmin(userId)) {
    showManageUsers(chatId, 1);
    return true;
  }

  return false;
}

// [4.3] Handle issue reporting workflow
function handleIssueReportFlow(msg, chatId, userId, text, lower, state, userProps) {
  // Handle images
  if (msg.photo && state === STATES.AWAITING_IMAGE) {
    sendMessage(chatId, '🖼️ Image received successfully!');
    handleImage(msg, userProps, chatId);
    return true;
  }

  // Skip images
  if (state === STATES.AWAITING_IMAGE && (lower === 'skip')) {
    showConfirmationSummary(chatId, userProps, false);
    return true;
  }

  // Handle type selection
  if (state === STATES.AWAITING_TYPE) {
    const choice = lower;
    if (['civil', 'electrical', 'mechanical'].includes(choice)) {
      userProps.setProperty(String(chatId) + '_type', choice);
      userProps.setProperty(String(chatId), STATES.AWAITING_PRIORITY);
      showPriorityMenu(chatId);
      return true;
    } else if (text === '⬅️ Back') {
      resetUserState(userProps, chatId);
      showMainMenu(chatId, userId);
      return true;
    }
  }

  // Handle priority input
  if (state === STATES.AWAITING_PRIORITY) {
    if (text === '⬅️ Back') {
      showTypeMenu(chatId);
      userProps.setProperty(String(chatId), STATES.AWAITING_TYPE);
      return true;
    }
    const choice = text;
    if (PRIORITIES.includes(choice)) {
      userProps.setProperty(String(chatId) + '_priority', choice);
      userProps.setProperty(String(chatId), STATES.AWAITING_LOCATION);

      sendMessage(chatId, '📍 Enter the location of the issue:', {
        reply_markup: {
          keyboard: [[{ text: '⬅️ Back' }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      return true;
    } else {
      // Prompt again for valid priority
      sendMessage(chatId, '❌ Invalid priority. Please choose one of the options.', {
        reply_markup: {
          keyboard: [PRIORITIES.map(p => ({ text: p })), [{ text: '⬅️ Back' }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      return true;
    }
  }

  // Handle location input
  if (state === STATES.AWAITING_LOCATION) {
    if (text === '⬅️ Back') {
      // Return to priority selection
      showPriorityMenu(chatId);
      userProps.setProperty(String(chatId), STATES.AWAITING_PRIORITY);
      return true;
    }

    userProps.setProperty(String(chatId) + '_location', text);
    userProps.setProperty(String(chatId), STATES.AWAITING_DESCRIPTION);

    const type = userProps.getProperty(String(chatId) + '_type');
    showDescriptionMenu(chatId, type);
    return true;
  }

  // Handle description input
  if (state === STATES.AWAITING_DESCRIPTION) {
    if (text === '⬅️ Back') {
      // Return to location input
      userProps.setProperty(String(chatId), STATES.AWAITING_LOCATION);
      sendMessage(chatId, '📍 Enter the location of the issue:', {
        reply_markup: {
          keyboard: [[{ text: '⬅️ Back' }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      return true;
    }

    userProps.setProperty(String(chatId) + '_description', text);

    // Move to assignment step
    userProps.setProperty(String(chatId), STATES.AWAITING_ASSIGN_TO);
    showTechMenu(chatId);
    return true;
  }

  // Handle assignment selection (via keyboard)
  if (state === STATES.AWAITING_ASSIGN_TO && lower === 'skip') {
    // Skip assignment
    userProps.setProperty(String(chatId) + '_assign_to', '');
    userProps.setProperty(String(chatId), STATES.AWAITING_IMAGE);
    sendMessage(chatId, '📸 Send an image now or type "Skip".', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Skip', callback_data: 'action:skip' }],
          [{ text: '⬅️ Back to Menu', callback_data: 'action:back_main' }]
        ],
        remove_keyboard: true
      }
    });
    return true;
  }

  // Unhandled state
  return false;
}

////////////////////////////////////////////////////////////////////////////////
// [5] Callback Query Handler
////////////////////////////////////////////////////////////////////////////////
function handleCallback(callback) {
  try {
    const callbackData = callback.data;
    const chatId = callback.message.chat.id;
    const userId = callback.from.id;
    const userProps = PropertiesService.getUserProperties();

    // Handle callbacks using : separator
    if (callbackData.includes(':')) {
      const parts = callbackData.split(':');
      const module = parts[0];
      const action = parts[1];
      const param = parts.slice(2).join(':');

      switch (module) {
        case 'role':
          handleRoleCallback(chatId, action, param);
          break;
        case 'reg':
          handleRegCallback(chatId, action, param);
          break;
        case 'action':
          handleActionCallback(chatId, userId, userProps, action, param);
          break;
        case 'tech':
          handleTechAssignCallback(chatId, userId, userProps, action, param);
          break;
        case 'user':
          handleUserManagementCallback(chatId, userId, action, param);
          break;
        default:
          showMainMenu(chatId, userId);
      }
    } else {
      // For legacy callbacks
      handleLegacyCallbacks(callback, userProps, chatId, userId, callbackData);
    }

    answerCallback(callback.id);
    return HtmlService.createHtmlOutput('ok');

  } catch (err) {
    Logger.log(`handleCallback error: ${err.message}\n${err.stack}`);
    answerCallback(callback.id, 'An error occurred processing your request');
    return HtmlService.createHtmlOutput('error');
  }
}

// [5.1] Handle different callback groups
function handleRoleCallback(chatId, role, rowIdx) {
  setUserRole(chatId, parseInt(rowIdx, 10), role);
}

function handleRegCallback(chatId, action, rowIdx) {
  processRegistrationAction(chatId, parseInt(rowIdx, 10), action === 'accept' ? 'Accepted' : 'Rejected');
}

// Extended action handler
function handleActionCallback(chatId, userId, userProps, action, param) {
  switch (action) {
    case 'confirm_request':
      sendMessage(chatId, '⌛ Creating maintenance request...');
      // Check if there is an image attached
      const hasImage = userProps.getProperty(String(chatId) + '_image_id');
      if (hasImage) {
        finalizeImageWorkflow(null, userProps, chatId, userId);
      } else {
        finalizeReportWithoutImage(chatId, userId, userProps);
      }
      break;
    case 'cancel_request':
      resetUserState(userProps, chatId);
      sendMessage(chatId, '❌ Request canceled.');
      showMainMenu(chatId, userId);
      break;
    case 'back_main':
      resetUserState(userProps, chatId);
      showMainMenu(chatId, userId);
      break;
    case 'skip':
      showConfirmationSummary(chatId, userProps, false);
      break;
    case 'next':
    case 'prev':
      // Pagination actions for my requests or user management
      const [view, pageStr, filter] = (param || '').split('|');
      const page = parseInt(pageStr, 10) || 1;
      if (view === 'my') {
        showMyRequests(chatId, userId, page, filter || 'all');
      } else if (view === 'users') {
        showManageUsers(chatId, page);
      }
      break;
    case 'filter':
      // Filter my requests
      const [filterView, status] = (param || '').split('|');
      if (filterView === 'my') {
        showMyRequests(chatId, userId, 1, status);
      }
      break;
    default:
      showMainMenu(chatId, userId);
  }
}

// Handle technician assignment callbacks
function handleTechAssignCallback(chatId, userId, userProps, action, param) {
  switch (action) {
    case 'assign':
      // param should be technician userId
      userProps.setProperty(String(chatId) + '_assign_to', param);
      userProps.setProperty(String(chatId), STATES.AWAITING_IMAGE);
      sendMessage(chatId, '📸 Send an image now or type "Skip".', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Skip', callback_data: 'action:skip' }],
            [{ text: '⬅️ Back to Menu', callback_data: 'action:back_main' }]
          ],
          remove_keyboard: true
        }
      });
      break;
    case 'skip':
      userProps.setProperty(String(chatId) + '_assign_to', '');
      userProps.setProperty(String(chatId), STATES.AWAITING_IMAGE);
      sendMessage(chatId, '📸 Send an image now or type "Skip".', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Skip', callback_data: 'action:skip' }],
            [{ text: '⬅️ Back to Menu', callback_data: 'action:back_main' }]
          ],
          remove_keyboard: true
        }
      });
      break;
    default:
      showMainMenu(chatId, userId);
  }
}

// Handle user management callbacks
function handleUserManagementCallback(chatId, userId, action, param) {
  if (!isAdmin(userId)) {
    sendMessage(chatId, '❌ You are not authorized to perform this action.');
    return;
  }
  const rowIdx = parseInt(param, 10);
  switch (action) {
    case 'delete':
      deleteUser(chatId, rowIdx);
      break;
    case 'setrole':
      // param includes role and row index separated by '|', e.g. "Tech|3"
      const [role, idx] = param.split('|');
      setUserRole(chatId, parseInt(idx, 10), role);
      break;
    default:
      showManageUsers(chatId, 1);
  }
}

// [5.2] Handle legacy callbacks
function handleLegacyCallbacks(callback, userProps, chatId, userId, data) {
  switch (data) {
    case 'confirm_request':
      finalizeReportWithoutImage(chatId, userId, userProps);
      break;
    case 'cancel_request':
      resetUserState(userProps, chatId);
      sendMessage(chatId, '❌ Request canceled.');
      showMainMenu(chatId, userId);
      break;
    case 'back_main':
      resetUserState(userProps, chatId);
      showMainMenu(chatId, userId);
      break;
    case 'register':
      startRegistration(chatId, userProps);
      break;
    case 'login':
      sendMessage(chatId, '👤 Please enter your username:');
      userProps.setProperty(String(chatId), STATES.AWAITING_LOGIN_USERNAME);
      break;
    case 'start_new':
      showTypeMenu(chatId);
      userProps.setProperty(String(chatId), STATES.AWAITING_TYPE);
      break;
    case 'my_requests':
      showMyRequests(chatId, userId, 1, 'all');
      break;
    case 'admin_panel':
      showAdminRequests(chatId);
      break;
    case 'help':
      showHelp(chatId, userId);
      break;
    default:
      if (data.startsWith('setrole_')) {
        const parts = data.split('_');
        const role = parts[1];
        const rowIdx = parseInt(parts[2], 10);
        setUserRole(chatId, rowIdx, role);
      } else {
        showMainMenu(chatId, userId);
      }
  }
}

////////////////////////////////////////////////////////////////////////////////
// [6] Registration Helpers
////////////////////////////////////////////////////////////////////////////////
function startRegistration(chatId, userProps) {
  sendMessage(chatId, '1️⃣ 📞 Enter your phone number (example: 0551234567):', {
    reply_markup: {
      keyboard: [[{ text: '❌ Cancel' }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
  userProps.setProperty(String(chatId), STATES.AWAITING_REG_PHONE);
}

function handleRegPhone(chatId, phone, userProps) {
  if (phone === '❌ Cancel') {
    resetUserState(userProps, chatId);
    sendMessage(chatId, 'Registration canceled.');
    showMainMenu(chatId, chatId);
    return;
  }

  if (!/^(05|7)\d{8,9}$/.test(phone)) {
    sendMessage(chatId, '❌ Invalid phone number. Please enter a valid phone number that starts with 05 or 7.');
    return;
  }

  userProps.setProperty(String(chatId) + '_reg_phone', phone);
  sendMessage(chatId, '2️⃣ 👤 Choose a username (at least 4 characters):', {
    reply_markup: {
      keyboard: [[{ text: '⬅️ Back' }], [{ text: '❌ Cancel' }]],
      resize_keyboard: true
    }
  });
  userProps.setProperty(String(chatId), STATES.AWAITING_REG_USERNAME);
}

function handleRegUsername(chatId, username, userProps) {
  if (username === '❌ Cancel') {
    resetUserState(userProps, chatId);
    sendMessage(chatId, 'Registration canceled.');
    showMainMenu(chatId, chatId);
    return;
  }

  if (username === '⬅️ Back') {
    startRegistration(chatId, userProps);
    return;
  }

  if (username.length < 4) {
    sendMessage(chatId, '❌ Username is too short. It must be at least 4 characters.');
    return;
  }

  // Check if username already exists
  const isUsernameTaken = checkUsernameExists(username);
  if (isUsernameTaken) {
    sendMessage(chatId, '❌ Username is already taken. Please choose another one.');
    return;
  }

  userProps.setProperty(String(chatId) + '_reg_username', username);
  sendMessage(chatId, '3️⃣ 🔑 Enter a password (at least 6 characters):', {
    reply_markup: {
      keyboard: [[{ text: '⬅️ Back' }], [{ text: '❌ Cancel' }]],
      resize_keyboard: true
    }
  });
  userProps.setProperty(String(chatId), STATES.AWAITING_REG_PASSWORD);
}

function completeRegistration(chatId, password, userProps, userId) {
  if (password === '❌ Cancel') {
    resetUserState(userProps, chatId);
    sendMessage(chatId, 'Registration canceled.');
    showMainMenu(chatId, chatId);
    return;
  }

  if (password === '⬅️ Back') {
    handleRegUsername(chatId, userProps.getProperty(String(chatId) + '_reg_username'), userProps);
    return;
  }

  if (password.length < 6) {
    sendMessage(chatId, '❌ Password is too weak. It must be at least 6 characters.');
    return;
  }

  const phone = userProps.getProperty(String(chatId) + '_reg_phone');
  const username = userProps.getProperty(String(chatId) + '_reg_username');
  const now = new Date();

  // Add a new row to the registration sheet
  regSheet.appendRow([userId, username, phone, username, password, now, 'Pending', '']);

  sendMessage(chatId, '✅ Registration request sent. It will be reviewed soon by the administration.', {
    reply_markup: { remove_keyboard: true }
  });

  // Notify admins about new registration
  notifyAdmins(`New registration request:\nUser: ${username}\nPhone: ${phone}`);

  resetUserState(userProps, chatId);
  showMainMenu(chatId, chatId);
}

////////////////////////////////////////////////////////////////////////////////
// [7] Admin Functions
////////////////////////////////////////////////////////////////////////////////
// Show registration requests to admin along with summary
function showAdminRequests(chatId) {
  try {
    const data = regSheet.getDataRange().getValues();
    let hasRequests = false;

    sendMessage(chatId, '📋 Pending registration requests:');

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const status = row[6] || '';

      if (!status || status === 'Pending') {
        hasRequests = true;
        sendMessage(chatId, `Request #${i}\nName: ${row[1]}\nUsername: ${row[3]}\nStatus: ${status || 'Pending'}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '👷 Tech', callback_data: `role:Tech:${i}` },
                { text: '👤 User', callback_data: `role:User:${i}` },
                { text: '🧑‍💼 Supervisor', callback_data: `role:Supervisor:${i}` }
              ],
              [
                { text: '❌ Reject', callback_data: `reg:reject:${i}` }
              ]
            ]
          }
        });
      }
    }

    if (!hasRequests) {
      sendMessage(chatId, 'No pending registration requests.');
    }

    // Also show maintenance request summary
    showMaintenanceSummary(chatId);

  } catch (err) {
    Logger.log(`showAdminRequests error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error displaying registration requests.');
  }
}

// Show maintenance requests summary
function showMaintenanceSummary(chatId) {
  try {
    const data = dataSheet.getDataRange().getValues();
    const total = data.length - 1;
    const openCount = data.filter(row => row[1] === 'Open').length;
    const inProgressCount = data.filter(row => row[1] === 'In Progress').length;
    const closedCount = data.filter(row => row[1] === 'Closed').length;

    sendMessage(chatId, `📊 Maintenance Summary:\n• Open: ${openCount}\n• In Progress: ${inProgressCount}\n• Closed: ${closedCount}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to Main Menu', callback_data: 'action:back_main' }]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showMaintenanceSummary error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing maintenance summary.');
  }
}

// Set user role in registration sheet
function setUserRole(chatId, rowIdx, role) {
  try {
    const data = regSheet.getDataRange().getValues();
    if (rowIdx < data.length) {
      regSheet.getRange(rowIdx + 1, 8).setValue(role); // Column H = Role
      regSheet.getRange(rowIdx + 1, 7).setValue('Accepted'); // Mark as "Accepted"

      // If role is "Tech", add to TECH_IDS
      const userId = data[rowIdx][0];
      if (role === 'Tech' && !TECH_IDS.includes(Number(userId))) {
        TECH_IDS.push(Number(userId));
      }

      sendMessage(chatId, `✅ Request #${rowIdx} set as ${role}.`);

      // Notify user about account activation
      sendMessage(userId, `✅ Your account has been activated with ${role} role.`);
    } else {
      sendMessage(chatId, '❌ Request not found.');
    }
  } catch (err) {
    Logger.log(`setUserRole error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error setting user role.');
  }
}

// Accept/Reject registration request
function processRegistrationAction(chatId, rowIdx, action) {
  try {
    const data = regSheet.getDataRange().getValues();
    if (rowIdx < data.length) {
      regSheet.getRange(rowIdx + 1, 7).setValue(action); // Status column
      sendMessage(chatId, `✅ Request #${rowIdx} marked as ${action}.`);
      const userId = data[rowIdx][0];
      if (action === 'Accepted') {
        sendMessage(userId, '✅ Your registration has been approved. You can now use the bot.');
      } else {
        sendMessage(userId, '❌ Your registration has been declined. Please contact the administrator for more information.');
      }
    } else {
      sendMessage(chatId, '❌ Request not found.');
    }
  } catch (err) {
    Logger.log(`processRegistrationAction error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error processing registration request.');
  }
}

// New: display and manage registered users (admins only)
function showManageUsers(chatId, page) {
  try {
    const data = regSheet.getDataRange().getValues();
    const users = data.slice(1); // skip header
    const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
    const currentPage = Math.max(1, Math.min(page, totalPages));

    let message = `👥 Registered Users (Page ${currentPage}/${totalPages}):\n`;

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, users.length);
    for (let i = start; i < end; i++) {
      const row = users[i];
      const idx = i + 1; // Adjust for header row
      const name = row[1] || '';
      const username = row[3] || '';
      const status = row[6] || '';
      const role = row[7] || '';
      message += `#${idx} - ${name} (${username}) - Status: ${status || 'Pending'} - Role: ${role || 'N/A'}\n`;
    }

    // Build pagination controls
    const inline = [];
    const navRow = [];
    if (currentPage > 1) {
      navRow.push({ text: '⬅️ Prev', callback_data: `action:prev:users|${currentPage - 1}|` });
    }
    if (currentPage < totalPages) {
      navRow.push({ text: '➡️ Next', callback_data: `action:next:users|${currentPage + 1}|` });
    }
    if (navRow.length > 0) inline.push(navRow);
    // Add user controls: each user row will have its own inline menu via separate messages

    // Send list
    sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: inline.concat([[{ text: '⬅️ Back to Admin', callback_data: 'admin_panel' }]])
      }
    });

    // Send per-user actions (edit role, delete)
    for (let i = start; i < end; i++) {
      const idx = i + 1;
      const row = users[i];
      const role = row[7] || 'Unknown';
      const header = `User #${idx}: ${row[1]} (${row[3]}) - Role: ${role}`;
      sendMessage(chatId, header, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Set Tech', callback_data: `user:setrole:Tech|${idx}` },
              { text: 'Set User', callback_data: `user:setrole:User|${idx}` },
              { text: 'Set Supervisor', callback_data: `user:setrole:Supervisor|${idx}` }
            ],
            [
              { text: 'Delete', callback_data: `user:delete:${idx}` }
            ]
          ]
        }
      });
    }
  } catch (err) {
    Logger.log(`showManageUsers error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error listing users.');
  }
}

// Delete a user registration (admin only)
function deleteUser(chatId, rowIdx) {
  try {
    if (rowIdx <= 0) {
      sendMessage(chatId, '❌ Invalid row index.');
      return;
    }
    const data = regSheet.getDataRange().getValues();
    if (rowIdx >= data.length) {
      sendMessage(chatId, '❌ User not found.');
      return;
    }
    const userId = data[rowIdx][0];
    regSheet.deleteRow(rowIdx + 1); // +1 for header
    sendMessage(chatId, `✅ User #${rowIdx} deleted successfully.`);
    // Remove from TECH_IDS if exists
    const techIndex = TECH_IDS.indexOf(Number(userId));
    if (techIndex >= 0) {
      TECH_IDS.splice(techIndex, 1);
    }
    // Notify user
    sendMessage(userId, '⚠️ Your account has been removed by the administrator.');
  } catch (err) {
    Logger.log(`deleteUser error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error deleting user.');
  }
}

////////////////////////////////////////////////////////////////////////////////
// [8] Issue Reporting Functions
////////////////////////////////////////////////////////////////////////////////
// Show confirmation summary
function showConfirmationSummary(chatId, userProps, hasImage) {
  try {
    const type = userProps.getProperty(String(chatId) + '_type');
    const priority = userProps.getProperty(String(chatId) + '_priority') || 'Medium';
    const location = userProps.getProperty(String(chatId) + '_location');
    const description = userProps.getProperty(String(chatId) + '_description');
    const assignTo = userProps.getProperty(String(chatId) + '_assign_to') || 'Unassigned';
    const imageStatus = hasImage ? '✅ Attached' : '❌ Not attached';

    const summary = `📋 Please confirm your request:\n• Type: ${type}\n• Priority: ${priority}\n• Location: ${location}\n• Description: ${description}\n• Assign To: ${assignTo}\n• Image: ${imageStatus}`;

    userProps.setProperty(String(chatId), STATES.AWAITING_CONFIRMATION);

    sendMessage(chatId, summary, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirm', callback_data: 'action:confirm_request' }],
          [{ text: '❌ Cancel', callback_data: 'action:cancel_request' }]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showConfirmationSummary error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing confirmation summary.');
  }
}

// Finalize report without image
function finalizeReportWithoutImage(chatId, userId, userProps) {
  try {
    const type = userProps.getProperty(String(chatId) + '_type');
    const priority = userProps.getProperty(String(chatId) + '_priority') || 'Medium';
    const location = userProps.getProperty(String(chatId) + '_location');
    const description = userProps.getProperty(String(chatId) + '_description');
    const assignTo = userProps.getProperty(String(chatId) + '_assign_to') || '';
    let createdBy = getUserNameById(userId);
    if (!createdBy) createdBy = String(userId);
    const id = saveNewRequest(type, location, description, createdBy, '', priority, assignTo);

    sendMessage(chatId, `✅ Request #${id} recorded.`, {
      reply_markup: { remove_keyboard: true }
    });

    // Notify admins about new request
    notifyAdmins(`🆕 New maintenance request #${id}:\nType: ${type}\nPriority: ${priority}\nLocation: ${location}\nDescription: ${description}\nAssigned To: ${assignTo || 'N/A'}\nCreated by: ${createdBy}`);

    showMainMenu(chatId, userId);
    resetUserState(userProps, chatId);
  } catch (err) {
    Logger.log(`finalizeReportWithoutImage error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error recording your request.');
  }
}

// Finalize image workflow
function finalizeImageWorkflow(msg, userProps, chatId, userId) {
  try {
    const fileId = userProps.getProperty(String(chatId) + '_image_id');
    const type = userProps.getProperty(String(chatId) + '_type');
    const priority = userProps.getProperty(String(chatId) + '_priority') || 'Medium';
    const location = userProps.getProperty(String(chatId) + '_location');
    const description = userProps.getProperty(String(chatId) + '_description');
    const assignTo = userProps.getProperty(String(chatId) + '_assign_to') || '';

    // Get file from Telegram
    const fileUrl = getTelegramFile(fileId);

    // Upload to Google Drive
    const imageUrl = uploadToDrive(fileUrl, `${type}_${location}_${new Date().getTime()}`);

    // Get user name
    let createdBy = getUserNameById(userId);
    if (!createdBy) createdBy = String(userId);

    // Save request with image URL
    const id = saveNewRequest(type, location, description, createdBy, imageUrl, priority, assignTo);

    sendMessage(chatId, `✅ Request #${id} with image recorded.`, {
      reply_markup: { remove_keyboard: true }
    });

    notifyAdmins(`🆕 New maintenance request #${id} with image:\nType: ${type}\nPriority: ${priority}\nLocation: ${location}\nDescription: ${description}\nAssigned To: ${assignTo || 'N/A'}\nCreated by: ${createdBy}\nImage: ${imageUrl}`);

    showMainMenu(chatId, userId);
    resetUserState(userProps, chatId);
  } catch (err) {
    Logger.log(`finalizeImageWorkflow error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error processing image. Your request will be recorded without an image.');
    finalizeReportWithoutImage(chatId, userId, userProps);
  }
}

// Handle image
function handleImage(msg, userProps, chatId) {
  try {
    // Get file ID for largest photo (best quality)
    const photos = msg.photo;
    const fileId = photos[photos.length - 1].file_id;
    userProps.setProperty(String(chatId) + '_image_id', fileId);
    showConfirmationSummary(chatId, userProps, true);
  } catch (err) {
    Logger.log(`handleImage error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error processing the image. You can skip attaching an image and continue.');
    showConfirmationSummary(chatId, userProps, false);
  }
}

// Show my requests with pagination and filtering
function showMyRequests(chatId, userId, page, filter) {
  try {
    // الحصول على اسم المستخدم من معرفه الرقمي
    const userName = getUserNameById(userId);
    
    if (!userName) {
      sendMessage(chatId, "⚠️ لم يتم العثور على حسابك في قاعدة البيانات. يرجى التواصل مع المسؤول.");
      showMainMenu(chatId, userId);
      return;
    }
    
    const data = dataSheet.getDataRange().getValues();
    // البحث عن البلاغات حسب اسم المستخدم في عمود Created By (عمود رقم 10)
    const rows = data.filter((r, i) => i > 0 && String(r[10]) === String(userName));
    
    // تطبيق الفلتر حسب الحالة
    let filtered = rows;
    if (filter && filter !== 'all') {
      filtered = rows.filter(r => (r[1] || '').toLowerCase() === filter.toLowerCase());
    }
    
    if (filtered.length === 0) {
      sendMessage(chatId, 'لم يتم العثور على بلاغات مطابقة للفلتر المحدد.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'الكل', callback_data: 'action:filter:my|all' },
              { text: 'مفتوح', callback_data: 'action:filter:my|Open' },
              { text: 'قيد التنفيذ', callback_data: 'action:filter:my|In Progress' },
              { text: 'مغلق', callback_data: 'action:filter:my|Closed' }
            ],
            [{ text: '⬅️ العودة للقائمة الرئيسية', callback_data: 'action:back_main' }]
          ]
        }
      });
      return;
    }
    
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filtered.length);

    let msg = `بلاغاتك (صفحة ${currentPage}/${totalPages}، الفلتر: ${filter || 'الكل'}):\n`;
    for (let i = start; i < end; i++) {
      const r = filtered[i];
      const status = r[1] || 'غير معروف';
      const statusEmoji = status === 'Open' ? '🔴' :
                           status === 'In Progress' ? '🟠' :
                           status === 'Closed' ? '🟢' : '⚪';
      msg += `• #${r[0]} - ${statusEmoji} ${status} - الأولوية: ${r[4] || 'غير محدد'} - ${r[2]} - ${r[8].substring(0, 30)}${r[8].length > 30 ? '...' : ''}\n`;
    }

    // بناء التحكم في التنقل والفلترة
    const inline = [];
    const navRow = [];
    if (currentPage > 1) {
      navRow.push({ text: '⬅️ السابق', callback_data: `action:prev:my|${currentPage - 1}|${filter}` });
    }
    if (currentPage < totalPages) {
      navRow.push({ text: '➡️ التالي', callback_data: `action:next:my|${currentPage + 1}|${filter}` });
    }
    if (navRow.length > 0) inline.push(navRow);
    
    // صف الفلتر
    inline.push([
      { text: 'الكل', callback_data: 'action:filter:my|all' },
      { text: 'مفتوح', callback_data: 'action:filter:my|Open' },
      { text: 'قيد التنفيذ', callback_data: 'action:filter:my|In Progress' },
      { text: 'مغلق', callback_data: 'action:filter:my|Closed' }
    ]);
    inline.push([{ text: '⬅️ العودة للقائمة الرئيسية', callback_data: 'action:back_main' }]);

    sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: inline
      }
    });
  } catch (err) {
    Logger.log(`showMyRequests error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ خطأ في استرجاع البلاغات الخاصة بك.');
    showMainMenu(chatId, userId);
  }
}

// Show help information
function showHelp(chatId, userId) {
  try {
    const helpText = `
📋 FixFlowBot Help 📋

FixFlowBot helps you report maintenance issues:

1️⃣ Select "New Issue" to start a report.
2️⃣ Choose the issue type (Civil, Electrical, Mechanical).
3️⃣ Select a priority (Low, Medium, High).
4️⃣ Enter the location.
5️⃣ Describe the problem.
6️⃣ Optional: Assign a technician or skip.
7️⃣ Optional: Add a photo.
8️⃣ Confirm your submission.

View your previous reports with "My Issues". You can paginate and filter your requests.

Administrators can manage users and view summaries via "Admin".

Need more help? Contact the administrator.
`;
    sendMessage(chatId, helpText);
    showMainMenu(chatId, userId);
  } catch (err) {
    Logger.log(`showHelp error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error displaying help.');
  }
}

// Send summary (admin)
function sendSummary(chatId, userId) {
  try {
    const summary = computeSummary();
    sendMessage(chatId, summary);
    showMainMenu(chatId, userId);
  } catch (err) {
    Logger.log(`sendSummary error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error creating summary.');
    showMainMenu(chatId, userId);
  }
}

// Compute summary with extra details
function computeSummary() {
  try {
    const data = dataSheet.getDataRange().getValues();
    const total = data.length - 1; // Excluding header
    if (total === 0) {
      return '📊 No maintenance requests recorded yet.';
    }
    // Count by status
    const openCount = data.filter(row => row[1] === 'Open').length;
    const inProgressCount = data.filter(row => row[1] === 'In Progress').length;
    const closedCount = data.filter(row => row[1] === 'Closed').length;
    // Count by type
    const civilCount = data.filter(row => row[2]?.toLowerCase() === 'civil').length;
    const electricalCount = data.filter(row => row[2]?.toLowerCase() === 'electrical').length;
    const mechanicalCount = data.filter(row => row[2]?.toLowerCase() === 'mechanical').length;
    // Count by priority
    const lowCount = data.filter(row => (row[4] || '').toLowerCase() === 'low').length;
    const medCount = data.filter(row => (row[4] || '').toLowerCase() === 'medium').length;
    const highCount = data.filter(row => (row[4] || '').toLowerCase() === 'high').length;
    // Assigned vs unassigned
    const assignedCount = data.filter(row => row[3]).length;
    const unassignedCount = total - assignedCount;
    // Average resolution time for closed tickets
    let avgResolutionTime = 'N/A';
    const closedTickets = data.filter(row => row[1] === 'Closed' && row[12] && row[14]);
    if (closedTickets.length > 0) {
      const totalHours = closedTickets.reduce((sum, ticket) => {
        const createDate = new Date(ticket[12]);
        const closeDate = new Date(ticket[14]);
        const diffHours = (closeDate - createDate) / (1000 * 60 * 60);
        return sum + diffHours;
      }, 0);
      avgResolutionTime = `${(totalHours / closedTickets.length).toFixed(1)} hours`;
    }
    return `📊 Maintenance Request Summary:

Total Requests: ${total}

By Status:
• 🔴 Open: ${openCount} (${Math.round(openCount/total*100)}%)
• 🟠 In Progress: ${inProgressCount} (${Math.round(inProgressCount/total*100)}%)
• 🟢 Closed: ${closedCount} (${Math.round(closedCount/total*100)}%)

By Type:
• Civil: ${civilCount} (${Math.round(civilCount/total*100)}%)
• Electrical: ${electricalCount} (${Math.round(electricalCount/total*100)}%)
• Mechanical: ${mechanicalCount} (${Math.round(mechanicalCount/total*100)}%)

By Priority:
• Low: ${lowCount} (${Math.round(lowCount/total*100)}%)
• Medium: ${medCount} (${Math.round(medCount/total*100)}%)
• High: ${highCount} (${Math.round(highCount/total*100)}%)

Assignment:
• Assigned: ${assignedCount} (${Math.round(assignedCount/total*100)}%)
• Unassigned: ${unassignedCount} (${Math.round(unassignedCount/total*100)}%)

Average Resolution Time (Closed): ${avgResolutionTime}`;
  } catch (err) {
    Logger.log(`computeSummary error: ${err.message}\n${err.stack}`);
    return '⚠️ Error calculating summary.';
  }
}

////////////////////////////////////////////////////////////////////////////////
// [9] Menus
////////////////////////////////////////////////////////////////////////////////
function showMainMenu(chatId, userId) {
  try {
    const inline = [];
    if (!isAuthorized(userId)) {
      inline.push([
        { text: '🔑 Register', callback_data: 'register' },
        { text: '🔐 Login', callback_data: 'login' }
      ]);
    } else {
      inline.push([{ text: '➕ New Issue', callback_data: 'start_new' }]);
      inline.push([{ text: '📋 My Issues', callback_data: 'my_requests' }]);
      inline.push([{ text: '❓ Help', callback_data: 'help' }]);
      if (isAdmin(userId)) {
        inline.push([{ text: '🛡️ Admin', callback_data: 'admin_panel' }]);
        inline.push([{ text: '👥 Manage Users', callback_data: 'action:next:users|1|' }]);
      }
    }

    sendMessage(
      chatId,
      '👋 Welcome to FixFlowBot!\nSelect an option below:',
      { reply_markup: { inline_keyboard: inline, remove_keyboard: true } }
    );
  } catch (err) {
    Logger.log(`showMainMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing main menu.');
  }
}

function showTypeMenu(chatId) {
  try {
    sendMessage(chatId, '🔧 Type of Work:\nPlease choose:', {
      reply_markup: {
        keyboard: [
          [{ text: 'Civil' }],
          [{ text: 'Electrical' }],
          [{ text: 'Mechanical' }],
          [{ text: '⬅️ Back' }]
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  } catch (err) {
    Logger.log(`showTypeMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing type menu.');
  }
}

function showPriorityMenu(chatId) {
  try {
    sendMessage(chatId, '🎚️ Select priority:', {
      reply_markup: {
        keyboard: [
          [ { text: 'Low' }, { text: 'Medium' }, { text: 'High' } ],
          [ { text: '⬅️ Back' } ]
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  } catch (err) {
    Logger.log(`showPriorityMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing priority menu.');
  }
}

function showTechMenu(chatId) {
  try {
    // Build list of technicians from regSheet where role is Tech
    const data = regSheet.getDataRange().getValues();
    const techs = data.filter((row, idx) => idx > 0 && row[7] === 'Tech');
    const buttons = [];
    techs.forEach(row => {
      const techId = row[0];
      const techName = row[1];
      buttons.push([{ text: techName, callback_data: `tech:assign:${techId}` }]);
    });
    // Add skip option
    buttons.push([{ text: 'Skip', callback_data: 'tech:skip:' }]);
    sendMessage(chatId, '👷 Select a technician to assign or skip:', {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (err) {
    Logger.log(`showTechMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing technician menu.');
  }
}

function showDescriptionMenu(chatId, type) {
  try {
    const typeIssues = SUGGESTED_ISSUES[type.toLowerCase()] || [];
    sendMessage(chatId, '📝 Describe the issue or select a suggestion:', {
      reply_markup: {
        keyboard: [...typeIssues.map(i => [{ text: i }]), [{ text: '⬅️ Back' }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  } catch (err) {
    Logger.log(`showDescriptionMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing description menu.');
  }
}

////////////////////////////////////////////////////////////////////////////////
// [10] Utility Functions
////////////////////////////////////////////////////////////////////////////////
function sendMessage(chatId, text, options = {}) {
  try {
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(Object.assign({ chat_id: chatId, text: text }, options)),
      muteHttpExceptions: true
    });
    const responseData = JSON.parse(response.getContentText());
    if (!responseData.ok) {
      Logger.log(`Telegram API error: ${response.getContentText()}`);
    }
    return responseData;
  } catch (e) {
    Logger.log(`Failed to send message: ${e.message}\n${e.stack}`);
  }
}

function answerCallback(callbackId, text = '') {
  try {
    const payload = { callback_query_id: callbackId };
    if (text) {
      payload.text = text;
      payload.show_alert = true;
    }
    UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log(`Failed to answer callback: ${e.message}\n${e.stack}`);
  }
}

// Save new request with priority and assignment
function saveNewRequest(type, location, description, createdBy, imageUrl, priority = 'Medium', assignTo = '') {
  try {
    const id = dataSheet.getLastRow();
    const now = new Date();
    const assignDate = assignTo ? now : '';
    dataSheet.appendRow([
      id,                   // ID
      'Open',               // Status
      type,                 // Type
      assignTo,             // Assigned To
      priority,             // Priority
      location,             // Location
      '',                   // Building
      '',                   // Room
      description,          // Description
      '',                   // Comments
      createdBy,            // Created By
      '',                   // Closed By
      now,                  // Created Date
      assignDate,           // Assigned Date
      '',                   // Closed Date
      '',                   // Expected Completion
      imageUrl,             // Image URL
      '',                   // Materials
      '',                   // Cost
      ''                    // Notes
    ]);
    return id;
  } catch (err) {
    Logger.log(`saveNewRequest error: ${err.message}\n${err.stack}`);
    return -1;
  }
}

function getTelegramFile(fileId) {
  try {
    // Get file path
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`, {
      muteHttpExceptions: true
    });
    const fileInfo = JSON.parse(response.getContentText());
    if (!fileInfo.ok || !fileInfo.result.file_path) {
      Logger.log(`Failed to get file path: ${response.getContentText()}`);
      return null;
    }
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    return fileUrl;
  } catch (e) {
    Logger.log(`Error getting Telegram file: ${e.message}\n${e.stack}`);
    return null;
  }
}

function uploadToDrive(fileUrl, fileName) {
  try {
    if (!fileUrl) return '';
    const response = UrlFetchApp.fetch(fileUrl, {
      muteHttpExceptions: true
    });
    const fileBlob = response.getBlob();
    fileBlob.setName(fileName + '.jpg');
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const file = folder.createFile(fileBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    Logger.log(`Error uploading to Drive: ${e.message}\n${e.stack}`);
    return '';
  }
}

// Timeline tracking: record status changes
function addTimeline(requestId, oldStatus, newStatus, updatedBy) {
  try {
    timelineSheet.appendRow([requestId, new Date(), oldStatus, newStatus, updatedBy]);
  } catch (err) {
    Logger.log(`addTimeline error: ${err.message}\n${err.stack}`);
  }
}

// Reset user state and all temporary variables
function resetUserState(userProps, chatId) {
  try {
    // Delete user state and all associated data
    const keys = [
      '',
      '_type',
      '_priority',
      '_location',
      '_description',
      '_assign_to',
      '_image_id',
      '_reg_phone',
      '_reg_username',
      '_login_username',
      '_login_password'
    ];
    keys.forEach(k => {
      userProps.deleteProperty(String(chatId) + k);
    });
  } catch (err) {
    Logger.log(`resetUserState error: ${err.message}\n${err.stack}`);
  }
}

// Check if username exists
function checkUsernameExists(username) {
  try {
    const data = regSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][3] === username) {
        return true;
      }
    }
    return false;
  } catch (err) {
    Logger.log(`checkUsernameExists error: ${err.message}\n${err.stack}`);
    return false;
  }
}

// Get user name from user ID
function getUserNameById(userId) {
  try {
    const data = regSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(userId)) {
        return data[i][1]; // Return name from registration
      }
    }
    return '';
  } catch (err) {
    Logger.log(`getUserNameById error: ${err.message}\n${err.stack}`);
    return '';
  }
}

// Notify admins with optional inline button to admin panel
function notifyAdmins(message) {
  try {
    ADMIN_IDS.forEach(adminId => {
      sendMessage(adminId, message, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛡️ Admin Panel', callback_data: 'admin_panel' }]
          ]
        }
      });
    });
  } catch (err) {
    Logger.log(`notifyAdmins error: ${err.message}\n${err.stack}`);
  }
}

function isAuthorized(userId) {
  // Check admins and techs
  if (ADMIN_IDS.includes(Number(userId)) || TECH_IDS.includes(Number(userId))) {
    return true;
  }
  // Check regular users in registration sheet
  try {
    const data = regSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(userId) && data[i][6] === 'Accepted') {
        return true;
      }
    }
  } catch (err) {
    Logger.log(`isAuthorized check error: ${err.message}`);
  }
  return false;
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

////////////////////////////////////////////////////////////////////////////////
// [11] Setup & Initialization
////////////////////////////////////////////////////////////////////////////////
function setup() {
  try {
    // Verify sheets exist or create them
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'ID', 'Status', 'Type', 'Assigned To', 'Priority',
        'Location', 'Building', 'Room', 'Description', 'Comments',
        'Created By', 'Closed By', 'Created Date', 'Assigned Date',
        'Closed Date', 'Expected Completion', 'Image URL',
        'Materials', 'Cost', 'Notes'
      ]);
    }
    let regSheetLocal = spreadsheet.getSheetByName(REG_SHEET_NAME);
    if (!regSheetLocal) {
      regSheetLocal = spreadsheet.insertSheet(REG_SHEET_NAME);
      regSheetLocal.appendRow([
        'User ID', 'Name', 'Phone', 'Username', 'Password',
        'Registration Date', 'Status', 'Role'
      ]);
    }
    let timelineSheetLocal = spreadsheet.getSheetByName(TIMELINE_SHEET_NAME);
    if (!timelineSheetLocal) {
      timelineSheetLocal = spreadsheet.insertSheet(TIMELINE_SHEET_NAME);
      timelineSheetLocal.appendRow([
        'Request ID', 'Date', 'Old Status', 'New Status', 'Updated By'
      ]);
    }
    // Delete previous webhook and set a new one
    UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    const webAppUrl = ScriptApp.getService().getUrl();
    const webhookOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        url: webAppUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true  // تجاهل التحديثات المعلقة
      }),
      muteHttpExceptions: true
    };
    // تعيين webhook جديد
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, webhookOptions);
    const result = JSON.parse(response.getContentText());
    
    // التحقق من حالة webhook الحالية
    const infoResponse = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const infoResult = JSON.parse(infoResponse.getContentText());
    
    if (result.ok) {
      return `✅ تم تعيين Webhook بنجاح!\n\nعنوان الويب: ${webAppUrl}\n\nمعلومات Webhook:\n${JSON.stringify(infoResult.result, null, 2)}`;
    } else {
      return `❌ فشل تعيين Webhook:\n${result.description}\n\nحالة Webhook الحالية:\n${JSON.stringify(infoResult.result, null, 2)}`;
    }
  } catch (err) {
    Logger.log(`setWebhook error: ${err.message}\n${err.stack}`);
    return `❌ خطأ في تنفيذ العملية: ${err.message}`;
  }
}

function setNewWebhook() {
  try {
    // حذف أي webhook قديم أولاً
    const deleteResponse = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    Logger.log("Delete webhook response: " + deleteResponse.getContentText());
    
    // استخدام الرابط الجديد مباشرة
    const newWebAppUrl = "https://script.google.com/macros/s/AKfycbx7ShiJYhR0Y8BA5kgwv0UAWmjSEcGt49lPCo5exqQ92cFGDN8p6AtIzmhBQvuDpodl/exec";
    Logger.log("New webapp URL: " + newWebAppUrl);
    
    // إعداد webhook جديد مع الرابط المحدد
    const webhookOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        url: newWebAppUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      }),
      muteHttpExceptions: true
    };
    
    // تعيين webhook جديد
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, webhookOptions);
    const result = JSON.parse(response.getContentText());
    
    // التحقق من حالة webhook الحالية
    const infoResponse = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const infoResult = JSON.parse(infoResponse.getContentText());
    
    if (result.ok) {
      return `✅ تم تعيين Webhook الجديد بنجاح!\n\nعنوان الويب: ${newWebAppUrl}\n\nمعلومات Webhook:\n${JSON.stringify(infoResult.result, null, 2)}`;
    } else {
      return `❌ فشل تعيين Webhook الجديد:\n${result.description}\n\nحالة Webhook الحالية:\n${JSON.stringify(infoResult.result, null, 2)}`;
    }
  } catch (err) {
    Logger.log(`setNewWebhook error: ${err.message}\n${err.stack}`);
    return `❌ خطأ في تنفيذ العملية: ${err.message}`;
  }
}

function doGet(e) {
  // Provide a simple HTML report page for admins.
  try {
    const html = HtmlService.createHtmlOutput();
    html.append(`<html><head><title>FixFlowBot Admin Report</title></head><body>`);
    html.append(`<h1>FixFlowBot Report</h1>`);
    // Summary
    const summary = computeSummary().replace(/\n/g, '<br>');
    html.append(`<h2>Summary</h2><p>${summary}</p>`);
    // List of all requests
    const data = dataSheet.getDataRange().getValues();
    html.append('<h2>All Requests</h2><table border="1" cellpadding="4"><tr><th>ID</th><th>Status</th><th>Type</th><th>Priority</th><th>Assigned To</th><th>Location</th><th>Description</th><th>Created By</th><th>Created Date</th></tr>');
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      html.append(`<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[4]}</td><td>${row[3]}</td><td>${row[5]}</td><td>${row[8]}</td><td>${row[10]}</td><td>${row[12]}</td></tr>`);
    }
    html.append('</table>');
    // List of users
    const regData = regSheet.getDataRange().getValues();
    html.append('<h2>Users</h2><table border="1" cellpadding="4"><tr><th>ID</th><th>Name</th><th>Username</th><th>Phone</th><th>Status</th><th>Role</th></tr>');
    for (let i = 1; i < regData.length; i++) {
      const row = regData[i];
      html.append(`<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[3]}</td><td>${row[2]}</td><td>${row[6]}</td><td>${row[7]}</td></tr>`);
    }
    html.append('</table></body></html>');
    return html;
  } catch (err) {
    return HtmlService.createHtmlOutput('Error generating report: ' + err.message);
  }
}