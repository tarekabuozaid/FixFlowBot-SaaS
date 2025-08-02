////////////////////////////////////////////////////////////////////////////////
// FixFlowBot – Enhanced & Modular – Updated 2025-07-29
////////////////////////////////////////////////////////////////////////////////
// [1] Configuration & Constants
////////////////////////////////////////////////////////////////////////////////
const BOT_TOKEN = '8384799464:AAHLlXJhUWm0AuXoyHX7iffcFJiG7l9U4e0';
const SHEET_NAME = 'Sheet1';  // تم التأكيد
const REG_SHEET_NAME = 'Registrations'; // تم التأكيد
const DRIVE_FOLDER_ID = '1-BTY6cG1qmSJ0aWU8D4AXOkB8gULMGHL';

const ADMIN_IDS = [7103238318];
const TECH_IDS = [7500135526];

// Cache spreadsheet references
const spreadsheet = SpreadsheetApp.openById('1THbDwp8EEW0oaAhlv8LI-qEvvcOR5st_uLZBeqL-91s');
const regSheet = spreadsheet.getSheetByName(REG_SHEET_NAME); // يشير إلى ورقة التسجيلات
const dataSheet = spreadsheet.getSheetByName(SHEET_NAME); // يشير إلى ورقة البيانات الرئيسية

// User states
const STATES = {
  AWAITING_REG_PHONE: 'awaiting_reg_phone',
  AWAITING_REG_USERNAME: 'awaiting_reg_username',
  AWAITING_REG_PASSWORD: 'awaiting_reg_password',
  AWAITING_LOGIN_USERNAME: 'awaiting_login_username',
  AWAITING_LOGIN_PASSWORD: 'awaiting_login_password',
  AWAITING_TYPE: 'awaiting_type',
  AWAITING_LOCATION: 'awaiting_location',
  AWAITING_DESCRIPTION: 'awaiting_description',
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

const ROLES = {
  TECH: 'Tech',
  USER: 'User',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin'
};

////////////////////////////////////////////////////////////////////////////////
// [2] Entry Point
////////////////////////////////////////////////////////////////////////////////
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    Logger.log(`Processing update: ${JSON.stringify(update)}`);
    
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
  if (lower === '/summary' && isAdmin(userId)) {
    sendSummary(chatId, userId);
    return true;
  }
  
  if (lower === '/new' || lower === 'new issue') {
    showTypeMenu(chatId);
    userProps.setProperty(String(chatId), STATES.AWAITING_TYPE);
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
  if (state === STATES.AWAITING_IMAGE && lower === 'skip') {
    showConfirmationSummary(chatId, userProps, false);
    return true;
  }
  
  // Handle type selection
  if (state === STATES.AWAITING_TYPE) {
    const choice = lower;
    
    if (['civil', 'electrical', 'mechanical'].includes(choice)) {
      userProps.setProperty(String(chatId) + '_type', choice);
      userProps.setProperty(String(chatId), STATES.AWAITING_LOCATION);
      
      sendMessage(chatId, '📍 Enter the location of the issue:', {
        reply_markup: {
          keyboard: [[{ text: '⬅️ Back' }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      return true;
    } else if (text === '⬅️ Back') {
      resetUserState(userProps, chatId);
      showMainMenu(chatId, userId);
      return true;
    }
  }
  
  // Handle location input
  if (state === STATES.AWAITING_LOCATION) {
    if (text === '⬅️ Back') {
      showTypeMenu(chatId);
      userProps.setProperty(String(chatId), STATES.AWAITING_TYPE);
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
    
    Logger.log(`Processing callback: ${callbackData} from user ${userId}`);
    
    // Handle callbacks using : separator
    if (callbackData.includes(':')) {
      const [module, action, param] = callbackData.split(':');
      
      switch (module) {
        case 'role':
          handleRoleCallback(chatId, action, param);
          break;
        case 'reg':
          handleRegCallback(chatId, action, param);
          break;
        case 'action':
          handleActionCallback(chatId, userId, userProps, action);
          break;
        default:
          showMainMenu(chatId, userId);
      }
    } else {
      // For compatibility with legacy callbacks
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

function handleActionCallback(chatId, userId, userProps, action) {
  switch (action) {
    case 'confirm_request':
      sendMessage(chatId, '⌛ Creating maintenance request...');
      // تحقق إذا كانت هناك صورة مرفقة
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
    default:
      showMainMenu(chatId, userId);
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
      showMyRequests(chatId, userId);
      break;
    case 'skip':
      showConfirmationSummary(chatId, userProps, false);
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
// Show registration requests to admin
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
        sendMessage(chatId, `Request #${i}\nName: ${row[1]}\nUsername: ${row[3]}\nStatus: ${status || 'Pending'}`,
          { reply_markup: { inline_keyboard: [
            [
              { text: '👷 Tech', callback_data: `role:Tech:${i}` },
              { text: '👤 User', callback_data: `role:User:${i}` },
              { text: '🧑‍💼 Supervisor', callback_data: `role:Supervisor:${i}` }
            ],
            [
              { text: '❌ Reject', callback_data: `reg:reject:${i}` }
            ]
          ] } }
        );
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
    Logger.log(`Setting user role: Row ${rowIdx}, Role ${role}`);
    const data = regSheet.getDataRange().getValues();
    
    if (rowIdx < data.length) {
      regSheet.getRange(rowIdx + 1, 8).setValue(role); // Column H (8th) = Role
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
    Logger.log(`Processing registration: Row ${rowIdx}, Action ${action}`);
    const data = regSheet.getDataRange().getValues();
    
    if (rowIdx < data.length) {
      regSheet.getRange(rowIdx + 1, 7).setValue(action); // Column G (7th) = Status
      
      sendMessage(chatId, `✅ Request #${rowIdx} marked as ${action}.`);
      
      // Notify user about registration status
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

////////////////////////////////////////////////////////////////////////////////
// [8] Issue Reporting Functions
////////////////////////////////////////////////////////////////////////////////
// Show confirmation summary
function showConfirmationSummary(chatId, userProps, hasImage) {
  try {
    const type = userProps.getProperty(String(chatId) + '_type');
    const location = userProps.getProperty(String(chatId) + '_location');
    const description = userProps.getProperty(String(chatId) + '_description');
    
    const imageStatus = hasImage ? '✅ Attached' : '❌ Not attached';
    
    const summary = `📋 Please confirm your request:\n• Type: ${type}\n• Location: ${location}\n• Description: ${description}\n• Image: ${imageStatus}`;
    
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
    const location = userProps.getProperty(String(chatId) + '_location');
    const description = userProps.getProperty(String(chatId) + '_description');
    
    // Get user name from registration if available
    let createdBy = getUserNameById(userId);
    
    // Use user ID if name not found
    if (!createdBy) {
      createdBy = String(userId);
    }
    
    const id = saveNewRequest(type, location, description, createdBy, '');
    
    sendMessage(chatId, `✅ Request #${id} recorded.`, {
      reply_markup: { remove_keyboard: true }
    });
    
    // Notify admins about new request
    notifyAdmins(`🆕 New maintenance request #${id}:\nType: ${type}\nLocation: ${location}\nDescription: ${description}\nCreated by: ${createdBy}`);
    
    showMainMenu(chatId, userId);
    resetUserState(userProps, chatId);
  } catch (err) {
    Logger.log(`finalizeReportWithoutImage error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error recording your request.');
  }
}

// Handle image
function handleImage(msg, userProps, chatId) {
  try {
    // Get file ID for largest photo (best quality)
    const photos = msg.photo;
    const fileId = photos[photos.length - 1].file_id;
    
    // Save file ID for later processing
    userProps.setProperty(String(chatId) + '_image_id', fileId);
    
    // Show confirmation
    showConfirmationSummary(chatId, userProps, true);
  } catch (err) {
    Logger.log(`handleImage error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error processing the image. You can skip attaching an image and continue.');
    showConfirmationSummary(chatId, userProps, false);
  }
}

// Finalize image workflow
function finalizeImageWorkflow(msg, userProps, chatId, userId) {
  try {
    const fileId = userProps.getProperty(String(chatId) + '_image_id');
    const type = userProps.getProperty(String(chatId) + '_type');
    const location = userProps.getProperty(String(chatId) + '_location');
    const description = userProps.getProperty(String(chatId) + '_description');
    
    // Get file from Telegram
    const fileUrl = getTelegramFile(fileId);
    
    // Upload to Google Drive
    const imageUrl = uploadToDrive(fileUrl, `${type}_${location}_${new Date().getTime()}`);
    
    // Get user name
    let createdBy = getUserNameById(userId);
    if (!createdBy) createdBy = String(userId);
    
    // Save request with image URL
    const id = saveNewRequest(type, location, description, createdBy, imageUrl);
    
    sendMessage(chatId, `✅ Request #${id} with image recorded.`, {
      reply_markup: { remove_keyboard: true }
    });
    
    notifyAdmins(`🆕 New maintenance request #${id} with image:\nType: ${type}\nLocation: ${location}\nDescription: ${description}\nCreated by: ${createdBy}\nImage: ${imageUrl}`);
    
    showMainMenu(chatId, userId);
    resetUserState(userProps, chatId);
  } catch (err) {
    Logger.log(`finalizeImageWorkflow error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error processing image. Your request will be recorded without an image.');
    finalizeReportWithoutImage(chatId, userId, userProps);
  }
}

// Show user requests
function showMyRequests(chatId, userId) {
  try {
    const data = dataSheet.getDataRange().getValues();
    const rows = data.filter((r, i) => i > 0 && String(r[10]) === String(userId));
    
    if (rows.length === 0) {
      sendMessage(chatId, 'No previous requests found.');
      showMainMenu(chatId, userId);
      return;
    }
    
    let msg = 'Your previous requests:\n';
    rows.forEach(r => {
      const status = r[1] || 'Unknown';
      const statusEmoji = status === 'Open' ? '🔴' : 
                          status === 'In Progress' ? '🟠' : 
                          status === 'Closed' ? '🟢' : '⚪';
      
      msg += `• #${r[0]} - ${statusEmoji} ${status} - ${r[2]} - ${r[8].substring(0, 30)}${r[8].length > 30 ? '...' : ''}\n`;
    });
    
    sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to Main Menu', callback_data: 'action:back_main' }]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showMyRequests error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error retrieving your requests.');
    showMainMenu(chatId, userId);
  }
}

// Send help information
function showHelp(chatId, userId) {
  try {
    const helpText = `
📋 FixFlowBot Help 📋

FixFlowBot helps you report maintenance issues:

1️⃣ Select "New Issue" to start a report
2️⃣ Choose the issue type (Civil, Electrical, Mechanical)
3️⃣ Enter the location
4️⃣ Describe the problem
5️⃣ Optional: Add a photo
6️⃣ Confirm your submission

View your previous reports with "My Issues"

Need more help? Contact the administrator.
`;
    sendMessage(chatId, helpText);
    showMainMenu(chatId, userId);
  } catch (err) {
    Logger.log(`showHelp error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error displaying help.');
  }
}

// Send summary
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

// Compute summary
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
    
    // Calculate average resolution time for closed tickets
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

Average Resolution Time: ${avgResolutionTime}`;
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
    sendMessage(chatId, '🔧 Type of Work:\nPlease choose:',
      { reply_markup: { keyboard: [
        [{ text: 'Civil' }], 
        [{ text: 'Electrical' }], 
        [{ text: 'Mechanical' }], 
        [{ text: '⬅️ Back' }]
      ], one_time_keyboard: true, resize_keyboard: true } }
    );
  } catch (err) {
    Logger.log(`showTypeMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing type menu.');
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

function saveNewRequest(type, location, description, createdBy, imageUrl) {
  try {
    const id = dataSheet.getLastRow();
    const now = new Date();
    
    dataSheet.appendRow([
      id,                   // ID
      'Open',               // Status
      type,                 // Type
      '',                   // Assigned To
      '',                   // Priority
      location,             // Location
      '',                   // Building
      '',                   // Room
      description,          // Description
      '',                   // Comments
      createdBy,            // Created By
      '',                   // Closed By
      now,                  // Created Date
      '',                   // Assigned Date
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
    
    // Get actual file URL
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
    
    // Download the file
    const response = UrlFetchApp.fetch(fileUrl, {
      muteHttpExceptions: true
    });
    
    const fileBlob = response.getBlob();
    fileBlob.setName(fileName + '.jpg');
    
    // Upload to Drive
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const file = folder.createFile(fileBlob);
    
    // Set sharing permissions (anyone with link can view)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return file.getUrl();
  } catch (e) {
    Logger.log(`Error uploading to Drive: ${e.message}\n${e.stack}`);
    return '';
  }
}

// Reset user state and all temporary variables
function resetUserState(userProps, chatId) {
  try {
    // Delete user state and all associated data
    userProps.deleteProperty(String(chatId));
    userProps.deleteProperty(String(chatId) + '_type');
    userProps.deleteProperty(String(chatId) + '_location');
    userProps.deleteProperty(String(chatId) + '_description');
    userProps.deleteProperty(String(chatId) + '_image_id');
    userProps.deleteProperty(String(chatId) + '_reg_phone');
    userProps.deleteProperty(String(chatId) + '_reg_username');
    userProps.deleteProperty(String(chatId) + '_login_username');
    userProps.deleteProperty(String(chatId) + '_login_password');
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

// Notify admins
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
  // تحقق من المشرفين والفنيين
  if (ADMIN_IDS.includes(Number(userId)) || TECH_IDS.includes(Number(userId))) {
    return true;
  }
  
  // تحقق من المستخدمين العاديين في جدول التسجيلات
  try {
    const data = regSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(userId) && 
          data[i][6] === 'Accepted') {
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
    // التحقق من وجود الأوراق وإنشائها إذا لم تكن موجودة
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
    
    let regSheet = spreadsheet.getSheetByName(REG_SHEET_NAME);
    if (!regSheet) {
      regSheet = spreadsheet.insertSheet(REG_SHEET_NAME);
      regSheet.appendRow([
        'User ID', 'Name', 'Phone', 'Username', 'Password', 
        'Registration Date', 'Status', 'Role'
      ]);
    }
    
    // حذف webhook سابق
    UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    
    // إعداد webhook جديد
    const webAppUrl = ScriptApp.getService().getUrl();
    const webhookOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        url: webAppUrl,
        allowed_updates: ["message", "callback_query"]
      })
    };
    
    const response = UrlFetchApp.fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, 
      webhookOptions
    );
    
    Logger.log("Webhook setup response: " + response.getContentText());
    
    const result = JSON.parse(response.getContentText());
    if (!result.ok) {
      throw new Error(`Webhook setup failed: ${result.description}`);
    }
    
    return 'Setup completed successfully! Webhook URL: ' + webAppUrl;
  } catch (err) {
    Logger.log(`Setup error: ${err.message}\n${err.stack}`);
    return `Setup failed: ${err.message}`;
  }
}

// For manual testing and debugging
function doGet(e) {
  return HtmlService.createHtmlOutput('FixFlowBot is running. Current time: ' + new Date());
}

function setWebhook() {
  const webAppUrl = "https://script.google.com/macros/s/AKfycbzZlP7c6UXQV7satCePxHuSohVLZ_5T2kgp-vPkfy-v-qFW0H87a-vgp5g1d-p-Jqyu/exec";
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webAppUrl}`
  );
  return response.getContentText();
}