////////////////////////////////////////////////////////////////////////////////
// FixFlowBot – Enhanced & Modular – Updated 2025-07-31
////////////////////////////////////////////////////////////////////////////////
// [1] Configuration & Constants
////////////////////////////////////////////////////////////////////////////////
const BOT_TOKEN = '8384799464:AAHLlXJhUWm0AuXoyHX7iffcFJiG7l9U4e0';
const SHEET_NAME = 'Sheet1';  // تم التأكيد
const REG_SHEET_NAME = 'Registrations'; // تم التأكيد
const DRIVE_FOLDER_ID = '1-BTY6cG1qmSJ0aWU8D4AXOkB8gULMGHL';
const TIMELINE_SHEET_NAME = 'Timeline'; // جدول جديد لتتبع تاريخ الطلبات

const ADMIN_IDS = [7103238318];
const TECH_IDS = [7500135526];

// Cache spreadsheet references
const spreadsheet = SpreadsheetApp.openById('1THbDwp8EEW0oaAhlv8LI-qEvvcOR5st_uLZBeqL-91s');
const regSheet = spreadsheet.getSheetByName(REG_SHEET_NAME); // يشير إلى ورقة التسجيلات
const dataSheet = spreadsheet.getSheetByName(SHEET_NAME); // يشير إلى ورقة البيانات الرئيسية
let timelineSheet;

try {
  timelineSheet = spreadsheet.getSheetByName(TIMELINE_SHEET_NAME);
  // إنشاء ورقة Timeline إذا لم تكن موجودة
  if (!timelineSheet) {
    timelineSheet = spreadsheet.insertSheet(TIMELINE_SHEET_NAME);
    timelineSheet.appendRow([
      'Request ID', 'Status', 'Updated By', 'Comments', 'Timestamp'
    ]);
  }
} catch (err) {
  Logger.log(`Timeline sheet initialization error: ${err.message}`);
}

// User states - حالات المستخدمين
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
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  // حالات جديدة للإدارة
  AWAITING_ASSIGN_TECH: 'awaiting_assign_tech',
  AWAITING_PRIORITY: 'awaiting_priority',
  AWAITING_STATUS_UPDATE: 'awaiting_status_update',
  AWAITING_COMMENT: 'awaiting_comment'
};

// Suggested issues by type - الأعطال المقترحة حسب النوع
const SUGGESTED_ISSUES = {
  civil: ['Broken tiles', 'Wall crack', 'Ceiling damage', 'Door issue'],
  electrical: ['Light not working', 'Power outlet issue', 'Circuit breaker tripped', 'Fan not working'],
  mechanical: ['Water leakage', 'AC not cooling', 'Heating issue', 'Plumbing problem']
};

// الحالات المتاحة للبلاغات
const STATUS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  CLOSED: 'Closed',
  PENDING: 'Pending',
  REJECTED: 'Rejected'
};

// الأدوار المتاحة للمستخدمين
const ROLES = {
  TECH: 'Tech',
  USER: 'User',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin'
};

// مستويات الأولوية للبلاغات
const PRIORITIES = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent'
};

// وقت تذكير المشرفين بالبلاغات المتأخرة (بالأيام)
const REMINDER_DAYS = {
  OPEN: 3,        // تذكير للبلاغات المفتوحة بعد 3 أيام
  IN_PROGRESS: 5  // تذكير للبلاغات قيد التنفيذ بعد 5 أيام
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
    
    // Handle new admin commands
    if (handleAdminCommands(msg, chatId, userId, text, lower, state, userProps)) {
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
    
    // Handle advanced admin states (new)
    if (handleAdvancedAdminFlow(msg, chatId, userId, text, lower, state, userProps)) {
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
// [4.0] New Admin Commands Handler - معالج الأوامر الإدارية الجديدة
////////////////////////////////////////////////////////////////////////////////
/**
 * معالجة الأوامر الإدارية الجديدة
 */
function handleAdminCommands(msg, chatId, userId, text, lower, state, userProps) {
  // التحقق من أن المستخدم مشرف
  if (!isAdmin(userId)) {
    return false;
  }
  
  // أوامر إدارية جديدة
  if (lower === '/users' || lower === 'users') {
    showUserManagement(chatId);
    return true;
  }
  
  if (lower === '/assign' || lower === 'assign') {
    showAssignmentMenu(chatId);
    return true;
  }
  
  if (lower === '/dashboard' || lower === 'dashboard') {
    showAdminDashboard(chatId);
    return true;
  }
  
  if (lower === '/report' || lower === 'report') {
    showWebReport(chatId);
    return true;
  }
  
  if (lower === '/check_pending' || lower === 'check pending') {
    checkPendingRequests(chatId);
    return true;
  }
  
  // معالجة الحالات الإدارية
  if (state === STATES.AWAITING_ASSIGN_TECH) {
    handleTechAssignment(chatId, text, userProps);
    return true;
  }
  
  if (state === STATES.AWAITING_PRIORITY) {
    handlePriorityAssignment(chatId, text, userProps);
    return true;
  }
  
  if (state === STATES.AWAITING_STATUS_UPDATE) {
    handleStatusUpdate(chatId, text, userProps, userId);
    return true;
  }
  
  if (state === STATES.AWAITING_COMMENT) {
    handleCommentAddition(chatId, text, userProps, userId);
    return true;
  }
  
  return false;
}

/**
 * عرض قائمة إدارة المستخدمين
 */
function showUserManagement(chatId) {
  try {
    const data = regSheet.getDataRange().getValues();
    const users = [];
    
    // تجميع المستخدمين حسب الدور
    const usersByRole = {
      'Admin': [],
      'Tech': [],
      'Supervisor': [],
      'User': []
    };
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][6] === 'Accepted') {
        const role = data[i][7] || 'User';
        usersByRole[role].push({
          id: data[i][0],
          name: data[i][1],
          username: data[i][3],
          rowIdx: i
        });
      }
    }
    
    // إرسال رسالة موجزة بالإحصائيات
    const summary = `👥 User Management\n\nTotal Users: ${data.length - 1}\n` +
      `• Admins: ${usersByRole['Admin'].length}\n` +
      `• Techs: ${usersByRole['Tech'].length}\n` +
      `• Supervisors: ${usersByRole['Supervisor'].length}\n` +
      `• Regular Users: ${usersByRole['User'].length}\n\n` +
      `Select a category to view users:`;
    
    sendMessage(chatId, summary, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👮 Admins', callback_data: 'users:list:Admin:1' },
            { text: '👨‍🔧 Techs', callback_data: 'users:list:Tech:1' }
          ],
          [
            { text: '👨‍💼 Supervisors', callback_data: 'users:list:Supervisor:1' },
            { text: '👤 Users', callback_data: 'users:list:User:1' }
          ],
          [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showUserManagement error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error displaying user management.');
  }
}

/**
 * عرض قائمة المستخدمين حسب الدور مع صفحات
 */
function listUsersByRole(chatId, role, page = 1) {
  try {
    const data = regSheet.getDataRange().getValues();
    const users = [];
    
    // تجميع المستخدمين بالدور المحدد
    for (let i = 1; i < data.length; i++) {
      if (data[i][6] === 'Accepted' && data[i][7] === role) {
        users.push({
          id: data[i][0],
          name: data[i][1],
          username: data[i][3],
          rowIdx: i
        });
      }
    }
    
    const itemsPerPage = 5;
    const totalPages = Math.ceil(users.length / itemsPerPage);
    const startIdx = (page - 1) * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, users.length);
    const usersToShow = users.slice(startIdx, endIdx);
    
    if (usersToShow.length === 0) {
      sendMessage(chatId, `No users found with ${role} role.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'users:manage' }]
          ]
        }
      });
      return;
    }
    
    // إنشاء قائمة المستخدمين
    let userList = `👥 ${role}s (Page ${page}/${totalPages || 1}):\n\n`;
    usersToShow.forEach(user => {
      userList += `• ${user.name} (@${user.username}) - ID: ${user.id}\n`;
    });
    
    // إنشاء أزرار الصفحات والإجراءات
    const inlineKeyboard = [];
    
    // أزرار للمستخدمين المعروضين
    usersToShow.forEach(user => {
      inlineKeyboard.push([
        { text: `✏️ ${user.name}`, callback_data: `users:edit:${user.rowIdx}` }
      ]);
    });
    
    // أزرار التنقل بين الصفحات
    const navigationRow = [];
    if (page > 1) {
      navigationRow.push({ text: '◀️ Previous', callback_data: `users:list:${role}:${page - 1}` });
    }
    if (page < totalPages) {
      navigationRow.push({ text: 'Next ▶️', callback_data: `users:list:${role}:${page + 1}` });
    }
    
    if (navigationRow.length > 0) {
      inlineKeyboard.push(navigationRow);
    }
    
    inlineKeyboard.push([{ text: '⬅️ Back', callback_data: 'users:manage' }]);
    
    sendMessage(chatId, userList, {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  } catch (err) {
    Logger.log(`listUsersByRole error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error listing users.');
  }
}

/**
 * عرض معلومات المستخدم وخيارات التعديل
 */
function showUserEditMenu(chatId, rowIdx) {
  try {
    const data = regSheet.getDataRange().getValues();
    if (rowIdx >= data.length) {
      sendMessage(chatId, '❌ User not found.');
      return;
    }
    
    const user = data[rowIdx];
    const userId = user[0];
    const name = user[1];
    const phone = user[2];
    const username = user[3];
    const regDate = user[5] ? new Date(user[5]).toLocaleDateString() : 'Unknown';
    const status = user[6] || 'Pending';
    const role = user[7] || 'User';
    
    const userInfo = `👤 User Details:\n\n` +
      `Name: ${name}\n` +
      `Username: ${username}\n` +
      `Phone: ${phone}\n` +
      `ID: ${userId}\n` +
      `Registered: ${regDate}\n` +
      `Status: ${status}\n` +
      `Role: ${role}\n\n` +
      `Select an action:`;
    
    const inlineKeyboard = [
      [
        { text: '👷 Set Tech', callback_data: `users:role:${rowIdx}:Tech` },
        { text: '👤 Set User', callback_data: `users:role:${rowIdx}:User` }
      ],
      [
        { text: '🧑‍💼 Set Supervisor', callback_data: `users:role:${rowIdx}:Supervisor` },
        { text: '🛡️ Set Admin', callback_data: `users:role:${rowIdx}:Admin` }
      ],
      [
        { text: status === 'Accepted' ? '❌ Deactivate' : '✅ Activate', 
          callback_data: status === 'Accepted' ? 
            `users:status:${rowIdx}:Rejected` : 
            `users:status:${rowIdx}:Accepted` }
      ],
      [
        { text: '🗑️ Delete', callback_data: `users:delete:${rowIdx}` },
        { text: '⬅️ Back', callback_data: `users:list:${role}:1` }
      ]
    ];
    
    sendMessage(chatId, userInfo, {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  } catch (err) {
    Logger.log(`showUserEditMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing user edit menu.');
  }
}

/**
 * تغيير دور المستخدم
 */
function changeUserRole(chatId, rowIdx, newRole) {
  try {
    const data = regSheet.getDataRange().getValues();
    if (rowIdx >= data.length) {
      sendMessage(chatId, '❌ User not found.');
      return;
    }
    
    // تحديث دور المستخدم
    regSheet.getRange(rowIdx + 1, 8).setValue(newRole);
    
    // إذا كان الدور هو فني، أضفه إلى قائمة الفنيين
    const userId = data[rowIdx][0];
    if (newRole === ROLES.TECH && !TECH_IDS.includes(Number(userId))) {
      TECH_IDS.push(Number(userId));
    }
    
    // إرسال تأكيد للمشرف
    sendMessage(chatId, `✅ User role updated to ${newRole}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to User', callback_data: `users:edit:${rowIdx}` }],
          [{ text: '👥 User Management', callback_data: 'users:manage' }]
        ]
      }
    });
    
    // إرسال إشعار للمستخدم
    sendMessage(userId, `📢 Your role has been updated to ${newRole}.`);
  } catch (err) {
    Logger.log(`changeUserRole error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error updating user role.');
  }
}

/**
 * تغيير حالة المستخدم (نشط/غير نشط)
 */
function changeUserStatus(chatId, rowIdx, newStatus) {
  try {
    const data = regSheet.getDataRange().getValues();
    if (rowIdx >= data.length) {
      sendMessage(chatId, '❌ User not found.');
      return;
    }
    
    // تحديث حالة المستخدم
    regSheet.getRange(rowIdx + 1, 7).setValue(newStatus);
    
    const userId = data[rowIdx][0];
    const statusText = newStatus === 'Accepted' ? 'activated' : 'deactivated';
    
    // إرسال تأكيد للمشرف
    sendMessage(chatId, `✅ User account ${statusText}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to User', callback_data: `users:edit:${rowIdx}` }],
          [{ text: '👥 User Management', callback_data: 'users:manage' }]
        ]
      }
    });
    
    // إرسال إشعار للمستخدم
    sendMessage(userId, `📢 Your account has been ${statusText}.`);
  } catch (err) {
    Logger.log(`changeUserStatus error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error updating user status.');
  }
}

/**
 * حذف المستخدم
 */
function deleteUser(chatId, rowIdx) {
  try {
    const data = regSheet.getDataRange().getValues();
    if (rowIdx >= data.length) {
      sendMessage(chatId, '❌ User not found.');
      return;
    }
    
    const userId = data[rowIdx][0];
    const username = data[rowIdx][3];
    
    // حذف المستخدم من جدول البيانات
    regSheet.deleteRow(rowIdx + 1);
    
    // إرسال تأكيد للمشرف
    sendMessage(chatId, `✅ User ${username} has been deleted.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👥 User Management', callback_data: 'users:manage' }]
        ]
      }
    });
    
    // إرسال إشعار للمستخدم
    try {
      sendMessage(userId, `📢 Your account has been deleted by an administrator.`);
    } catch (err) {
      // تجاهل أخطاء الإرسال للمستخدم المحذوف
      Logger.log(`Could not notify deleted user: ${err.message}`);
    }
  } catch (err) {
    Logger.log(`deleteUser error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error deleting user.');
  }
}

/**
 * عرض قائمة تعيين الفنيين للبلاغات
 */
function showAssignmentMenu(chatId) {
  try {
    // جلب البلاغات المفتوحة غير المعينة
    const data = dataSheet.getDataRange().getValues();
    const unassignedRequests = data.filter((row, idx) => 
      idx > 0 && row[1] === STATUS.OPEN && !row[3]
    );
    
    if (unassignedRequests.length === 0) {
      sendMessage(chatId, '✅ No unassigned open requests.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
          ]
        }
      });
      return;
    }
    
    // إرسال رسالة بالبلاغات غير المعينة
    let message = '🔄 Unassigned Open Requests:\n\n';
    const keyboard = [];
    
    unassignedRequests.forEach(row => {
      message += `• Request #${row[0]} - ${row[2]} - ${row[5]}: ${row[8].substring(0, 30)}${row[8].length > 30 ? '...' : ''}\n`;
      keyboard.push([
        { text: `Assign #${row[0]}`, callback_data: `assign:request:${row[0]}` }
      ]);
    });
    
    keyboard.push([
      { text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }
    ]);
    
    sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (err) {
    Logger.log(`showAssignmentMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing assignment menu.');
  }
}

/**
 * عرض قائمة الفنيين لتعيين بلاغ لأحدهم
 */
function showTechList(chatId, requestId) {
  try {
    // جلب قائمة الفنيين
    const data = regSheet.getDataRange().getValues();
    const techs = data.filter(row => 
      row[6] === 'Accepted' && row[7] === ROLES.TECH
    );
    
    if (techs.length === 0) {
      sendMessage(chatId, '❌ No techs available for assignment.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'assign:menu' }]
          ]
        }
      });
      return;
    }
    
    // حفظ معرف البلاغ
    const userProps = PropertiesService.getUserProperties();
    userProps.setProperty(String(chatId) + '_assign_request_id', requestId);
    
    // إرسال قائمة الفنيين
    let message = `👨‍🔧 Select a technician to assign request #${requestId}:\n\n`;
    const keyboard = [];
    
    techs.forEach(tech => {
      keyboard.push([
        { text: tech[1] || tech[3], callback_data: `assign:tech:${tech[0]}` }
      ]);
    });
    
    keyboard.push([
      { text: '⬅️ Back', callback_data: 'assign:menu' }
    ]);
    
    sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (err) {
    Logger.log(`showTechList error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing tech list.');
  }
}

/**
 * تعيين فني لبلاغ محدد
 */
function assignTechToRequest(chatId, techId) {
  try {
    // استرجاع معرف البلاغ من خصائص المستخدم
    const userProps = PropertiesService.getUserProperties();
    const requestId = userProps.getProperty(String(chatId) + '_assign_request_id');
    
    if (!requestId) {
      sendMessage(chatId, '❌ Request ID not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'assign:menu' }]
          ]
        }
      });
      return;
    }
    
    // البحث عن صف البلاغ
    const data = dataSheet.getDataRange().getValues();
    let rowIdx = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) {
        rowIdx = i;
        break;
      }
    }
    
    if (rowIdx === -1) {
      sendMessage(chatId, '❌ Request not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'assign:menu' }]
          ]
        }
      });
      return;
    }
    
    // جلب اسم الفني
    const techName = getUserNameById(techId);
    
    // تعيين الفني للبلاغ وتحديث التاريخ
    const now = new Date();
    dataSheet.getRange(rowIdx + 1, 4).setValue(techId); // Assigned To
    dataSheet.getRange(rowIdx + 1, 14).setValue(now); // Assigned Date
    
    // تسجيل في جدول التاريخ
    recordTimeline(requestId, 'Assigned', chatId, `Assigned to ${techName || techId}`, now);
    
    // إرسال تأكيد للمشرف
    sendMessage(chatId, `✅ Request #${requestId} assigned to ${techName || techId}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Set Priority', callback_data: `request:priority:${requestId}` }],
          [{ text: '⬅️ Back', callback_data: 'assign:menu' }]
        ]
      }
    });
    
    // إرسال إشعار للفني
    const requestDetails = data[rowIdx];
    const requestType = requestDetails[2];
    const requestLocation = requestDetails[5];
    const requestDescription = requestDetails[8];
    
    sendMessage(techId, `🔔 New Assignment: Request #${requestId}\nType: ${requestType}\nLocation: ${requestLocation}\nDescription: ${requestDescription}`);
    
    // إرسال إشعار لصاحب البلاغ
    const createdBy = requestDetails[10];
    if (createdBy && !isNaN(createdBy)) {
      sendMessage(createdBy, `🔔 Update: Your request #${requestId} has been assigned to a technician.`);
    }
    
    // مسح معرف البلاغ من خصائص المستخدم
    userProps.deleteProperty(String(chatId) + '_assign_request_id');
  } catch (err) {
    Logger.log(`assignTechToRequest error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error assigning tech to request.');
  }
}

/**
 * عرض قائمة اختيار الأولوية للبلاغ
 */
function showPriorityMenu(chatId, requestId) {
  try {
    // حفظ معرف البلاغ في خصائص المستخدم
    const userProps = PropertiesService.getUserProperties();
    userProps.setProperty(String(chatId) + '_priority_request_id', requestId);
    
    // إرسال خيارات الأولوية
    sendMessage(chatId, `🔢 Select priority for request #${requestId}:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 Low', callback_data: 'priority:set:Low' },
            { text: '🟡 Medium', callback_data: 'priority:set:Medium' }
          ],
          [
            { text: '🟠 High', callback_data: 'priority:set:High' },
            { text: '🔴 Urgent', callback_data: 'priority:set:Urgent' }
          ],
          [
            { text: '⬅️ Back', callback_data: 'admin_panel' }
          ]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showPriorityMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing priority menu.');
  }
}

/**
 * تعيين أولوية لبلاغ
 */
function setPriorityForRequest(chatId, priority) {
  try {
    // استرجاع معرف البلاغ من خصائص المستخدم
    const userProps = PropertiesService.getUserProperties();
    const requestId = userProps.getProperty(String(chatId) + '_priority_request_id');
    
    if (!requestId) {
      sendMessage(chatId, '❌ Request ID not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }]
          ]
        }
      });
      return;
    }
    
    // البحث عن صف البلاغ
    const data = dataSheet.getDataRange().getValues();
    let rowIdx = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) {
        rowIdx = i;
        break;
      }
    }
    
    if (rowIdx === -1) {
      sendMessage(chatId, '❌ Request not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }]
          ]
        }
      });
      return;
    }
    
    // تعيين الأولوية للبلاغ
    dataSheet.getRange(rowIdx + 1, 5).setValue(priority); // Priority
    
    // تسجيل في جدول التاريخ
    recordTimeline(requestId, 'Priority Updated', chatId, `Priority set to ${priority}`);
    
    // إرسال تأكيد للمشرف
    sendMessage(chatId, `✅ Priority for request #${requestId} set to ${priority}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Update Status', callback_data: `request:status:${requestId}` }],
          [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
        ]
      }
    });
    
    // إرسال إشعار للفني المعين (إن وجد)
    const assignedTo = data[rowIdx][3];
    if (assignedTo) {
      sendMessage(assignedTo, `🔔 Update: Priority for request #${requestId} has been set to ${priority}.`);
    }
    
    // إرسال إشعار لصاحب البلاغ
    const createdBy = data[rowIdx][10];
    if (createdBy && !isNaN(createdBy)) {
      sendMessage(createdBy, `🔔 Update: Your request #${requestId} has been assigned ${priority} priority.`);
    }
    
    // مسح معرف البلاغ من خصائص المستخدم
    userProps.deleteProperty(String(chatId) + '_priority_request_id');
  } catch (err) {
    Logger.log(`setPriorityForRequest error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error setting priority for request.');
  }
}

/**
 * عرض قائمة تحديث حالة البلاغ
 */
function showStatusUpdateMenu(chatId, requestId) {
  try {
    // حفظ معرف البلاغ في خصائص المستخدم
    const userProps = PropertiesService.getUserProperties();
    userProps.setProperty(String(chatId) + '_status_request_id', requestId);
    
    // إرسال خيارات الحالة
    sendMessage(chatId, `🔄 Select new status for request #${requestId}:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔴 Open', callback_data: 'status:set:Open' },
            { text: '🟠 In Progress', callback_data: 'status:set:In Progress' }
          ],
          [
            { text: '🟢 Closed', callback_data: 'status:set:Closed' },
            { text: '⚪ Pending', callback_data: 'status:set:Pending' }
          ],
          [
            { text: '⬅️ Back', callback_data: 'admin_panel' }
          ]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showStatusUpdateMenu error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing status update menu.');
  }
}

/**
 * تحديث حالة بلاغ
 */
function updateRequestStatus(chatId, status) {
  try {
    // استرجاع معرف البلاغ من خصائص المستخدم
    const userProps = PropertiesService.getUserProperties();
    const requestId = userProps.getProperty(String(chatId) + '_status_request_id');
    
    if (!requestId) {
      sendMessage(chatId, '❌ Request ID not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }]
          ]
        }
      });
      return;
    }
    
    // البحث عن صف البلاغ
    const data = dataSheet.getDataRange().getValues();
    let rowIdx = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) {
        rowIdx = i;
        break;
      }
    }
    
    if (rowIdx === -1) {
      sendMessage(chatId, '❌ Request not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }]
          ]
        }
      });
      return;
    }
    
    const now = new Date();
    
    // تحديث حالة البلاغ
    dataSheet.getRange(rowIdx + 1, 2).setValue(status); // Status
    
    // إذا كانت الحالة "مغلق"، تحديث تاريخ الإغلاق
    if (status === STATUS.CLOSED) {
      dataSheet.getRange(rowIdx + 1, 15).setValue(now); // Closed Date
      dataSheet.getRange(rowIdx + 1, 12).setValue(getUserNameById(chatId)); // Closed By
    }
    
    // تسجيل في جدول التاريخ
    recordTimeline(requestId, status, chatId, `Status changed to ${status}`);
    
    // سؤال عن إضافة تعليق
    userProps.setProperty(String(chatId) + '_comment_request_id', requestId);
    
    sendMessage(chatId, `✅ Status for request #${requestId} updated to ${status}.\n\nAdd a comment about this update (or type "Skip" to skip):`, {
      reply_markup: {
        force_reply: true
      }
    });
    
    userProps.setProperty(String(chatId), STATES.AWAITING_COMMENT);
    
    // إرسال إشعار للفني المعين (إن وجد)
    const assignedTo = data[rowIdx][3];
    if (assignedTo && assignedTo !== chatId) {
      sendMessage(assignedTo, `🔔 Update: Request #${requestId} status has been changed to ${status}.`);
    }
    
    // إرسال إشعار لصاحب البلاغ
    const createdBy = data[rowIdx][10];
    if (createdBy && !isNaN(createdBy)) {
      sendMessage(createdBy, `🔔 Update: Your request #${requestId} status has been changed to ${status}.`);
    }
    
    // مسح معرف البلاغ من خصائص المستخدم
    userProps.deleteProperty(String(chatId) + '_status_request_id');
  } catch (err) {
    Logger.log(`updateRequestStatus error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error updating request status.');
  }
}

/**
 * معالجة إضافة تعليق
 */
function handleCommentAddition(chatId, comment, userProps, userId) {
  try {
    const requestId = userProps.getProperty(String(chatId) + '_comment_request_id');
    
    if (!requestId) {
      sendMessage(chatId, '❌ Request ID not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }]
          ]
        }
      });
      resetUserState(userProps, chatId);
      return;
    }
    
    if (comment.toLowerCase() === 'skip') {
      sendMessage(chatId, '✅ No comment added.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
          ]
        }
      });
      resetUserState(userProps, chatId);
      return;
    }
    
    // البحث عن صف البلاغ
    const data = dataSheet.getDataRange().getValues();
    let rowIdx = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) {
        rowIdx = i;
        break;
      }
    }
    
    if (rowIdx === -1) {
      sendMessage(chatId, '❌ Request not found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }]
          ]
        }
      });
      resetUserState(userProps, chatId);
      return;
    }
    
    // إضافة التعليق إلى البلاغ
    const existingComment = data[rowIdx][9] || '';
    const updatedComment = existingComment ? 
      `${existingComment}\n${new Date().toLocaleString()}: ${comment}` : 
      `${new Date().toLocaleString()}: ${comment}`;
    
    dataSheet.getRange(rowIdx + 1, 10).setValue(updatedComment); // Comments
    
    // تسجيل في جدول التاريخ
    recordTimeline(requestId, 'Comment Added', chatId, comment);
    
    // إرسال تأكيد للمشرف
    sendMessage(chatId, `✅ Comment added to request #${requestId}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
        ]
      }
    });
    
    // إرسال إشعار للفني المعين (إن وجد)
    const assignedTo = data[rowIdx][3];
    if (assignedTo && assignedTo !== chatId) {
      sendMessage(assignedTo, `🔔 New comment on request #${requestId}: "${comment}"`);
    }
    
    // إرسال إشعار لصاحب البلاغ
    const createdBy = data[rowIdx][10];
    if (createdBy && !isNaN(createdBy)) {
      sendMessage(createdBy, `🔔 New comment on your request #${requestId}: "${comment}"`);
    }
    
    resetUserState(userProps, chatId);
  } catch (err) {
    Logger.log(`handleCommentAddition error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error adding comment to request.');
    resetUserState(userProps, chatId);
  }
}

/**
 * عرض لوحة معلومات المشرف
 */
function showAdminDashboard(chatId) {
  try {
    const summary = computeDetailedSummary();
    
    // إرسال لوحة المعلومات
    sendMessage(chatId, summary, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👥 Users', callback_data: 'users:manage' },
            { text: '🔄 Assign', callback_data: 'assign:menu' }
          ],
          [
            { text: '📊 View Report', callback_data: 'report:view' },
            { text: '⏰ Check Pending', callback_data: 'requests:check_pending' }
          ],
          [
            { text: '⬅️ Back to Main Menu', callback_data: 'back_main' }
          ]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showAdminDashboard error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error showing admin dashboard.');
  }
}

/**
 * حساب ملخص مفصل للبلاغات
 */
function computeDetailedSummary() {
  try {
    const data = dataSheet.getDataRange().getValues();
    const total = data.length - 1; // باستثناء الرأس
    
    if (total === 0) {
      return '📊 No maintenance requests recorded yet.';
    }
    
    // العد حسب الحالة
    const openCount = data.filter(row => row[1] === STATUS.OPEN).length;
    const inProgressCount = data.filter(row => row[1] === STATUS.IN_PROGRESS).length;
    const closedCount = data.filter(row => row[1] === STATUS.CLOSED).length;
    const pendingCount = data.filter(row => row[1] === STATUS.PENDING).length;
    
    // العد حسب النوع
    const civilCount = data.filter(row => row[2]?.toLowerCase() === 'civil').length;
    const electricalCount = data.filter(row => row[2]?.toLowerCase() === 'electrical').length;
    const mechanicalCount = data.filter(row => row[2]?.toLowerCase() === 'mechanical').length;
    
    // العد حسب الأولوية
    const urgentCount = data.filter(row => row[4] === PRIORITIES.URGENT && row[1] !== STATUS.CLOSED).length;
    const highCount = data.filter(row => row[4] === PRIORITIES.HIGH && row[1] !== STATUS.CLOSED).length;
    
    // البلاغات الجديدة في آخر 24 ساعة
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const newRequestsCount = data.filter(row => {
      if (row[12]) {
        const createDate = new Date(row[12]);
        return createDate >= oneDayAgo;
      }
      return false;
    }).length;
    
    // البلاغات المتأخرة (مفتوحة لأكثر من 3 أيام)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const delayedRequestsCount = data.filter(row => {
      if (row[12] && row[1] !== STATUS.CLOSED) {
        const createDate = new Date(row[12]);
        return createDate <= threeDaysAgo;
      }
      return false;
    }).length;
    
    // حساب متوسط وقت الحل للتذاكر المغلقة
    let avgResolutionTime = 'N/A';
    const closedTickets = data.filter(row => row[1] === STATUS.CLOSED && row[12] && row[14]);
    
    if (closedTickets.length > 0) {
      const totalHours = closedTickets.reduce((sum, ticket) => {
        const createDate = new Date(ticket[12]);
        const closeDate = new Date(ticket[14]);
        const diffHours = (closeDate - createDate) / (1000 * 60 * 60);
        return sum + diffHours;
      }, 0);
      
      avgResolutionTime = `${(totalHours / closedTickets.length).toFixed(1)} hours`;
    }
    
    // الفني الأكثر إنجازًا
    const techCompletions = {};
    data.filter(row => row[1] === STATUS.CLOSED && row[3]).forEach(row => {
      const techId = row[3];
      techCompletions[techId] = (techCompletions[techId] || 0) + 1;
    });
    
    let topTechId = null;
    let topTechCount = 0;
    
    for (const [techId, count] of Object.entries(techCompletions)) {
      if (count > topTechCount) {
        topTechId = techId;
        topTechCount = count;
      }
    }
    
    const topTechName = topTechId ? getUserNameById(topTechId) || topTechId : 'N/A';
    
    return `📊 Maintenance Dashboard\n\nTotal Requests: ${total}\n\n` +
      `By Status:\n` +
      `• 🔴 Open: ${openCount} (${Math.round(openCount/total*100)}%)\n` +
      `• 🟠 In Progress: ${inProgressCount} (${Math.round(inProgressCount/total*100)}%)\n` +
      `• 🟢 Closed: ${closedCount} (${Math.round(closedCount/total*100)}%)\n` +
      `• ⚪ Pending: ${pendingCount} (${Math.round(pendingCount/total*100)}%)\n\n` +
      
      `By Type:\n` +
      `• Civil: ${civilCount} (${Math.round(civilCount/total*100)}%)\n` +
      `• Electrical: ${electricalCount} (${Math.round(electricalCount/total*100)}%)\n` +
      `• Mechanical: ${mechanicalCount} (${Math.round(mechanicalCount/total*100)}%)\n\n` +
      
      `Highlights:\n` +
      `• ⚠️ Urgent requests: ${urgentCount}\n` +
      `• ⚡ High priority: ${highCount}\n` +
      `• 🕒 Delayed requests: ${delayedRequestsCount}\n` +
      `• 🆕 New in 24h: ${newRequestsCount}\n` +
      `• 👨‍🔧 Top tech: ${topTechName} (${topTechCount} closures)\n` +
      `• ⏱️ Avg resolution: ${avgResolutionTime}`;
  } catch (err) {
    Logger.log(`computeDetailedSummary error: ${err.message}\n${err.stack}`);
    return '⚠️ Error calculating detailed summary.';
  }
}

/**
 * فحص البلاغات المتأخرة وإرسال تنبيهات للمشرفين
 */
function checkPendingRequests(chatId) {
  try {
    const data = dataSheet.getDataRange().getValues();
    
    // البلاغات المفتوحة المتأخرة (أكثر من 3 أيام)
    const openDelayThreshold = new Date();
    openDelayThreshold.setDate(openDelayThreshold.getDate() - REMINDER_DAYS.OPEN);
    
    const delayedOpenRequests = data.filter((row, idx) => {
      if (idx > 0 && row[1] === STATUS.OPEN && row[12]) {
        const createDate = new Date(row[12]);
        return createDate <= openDelayThreshold;
      }
      return false;
    });
    
    // البلاغات قيد التنفيذ المتأخرة (أكثر من 5 أيام)
    const inProgressDelayThreshold = new Date();
    inProgressDelayThreshold.setDate(inProgressDelayThreshold.getDate() - REMINDER_DAYS.IN_PROGRESS);
    
    const delayedInProgressRequests = data.filter((row, idx) => {
      if (idx > 0 && row[1] === STATUS.IN_PROGRESS && row[12]) {
        const createDate = new Date(row[12]);
        return createDate <= inProgressDelayThreshold;
      }
      return false;
    });
    
    // البلاغات عالية الأولوية والعاجلة
    const highPriorityRequests = data.filter((row, idx) => {
      if (idx > 0 && (row[1] === STATUS.OPEN || row[1] === STATUS.IN_PROGRESS)) {
        return row[4] === PRIORITIES.URGENT || row[4] === PRIORITIES.HIGH;
      }
      return false;
    });
    
    // البلاغات غير المعينة
    const unassignedRequests = data.filter((row, idx) => 
      idx > 0 && row[1] === STATUS.OPEN && !row[3]
    );
    
    // إعداد رسالة التنبيه
    let alertMessage = '⚠️ Maintenance Alerts:\n\n';
    
    if (delayedOpenRequests.length > 0) {
      alertMessage += `🕒 ${delayedOpenRequests.length} open request(s) delayed more than ${REMINDER_DAYS.OPEN} days:\n`;
      delayedOpenRequests.slice(0, 5).forEach(row => {
        alertMessage += `• #${row[0]} - ${row[2]} - ${formatDate(row[12])}\n`;
      });
      if (delayedOpenRequests.length > 5) {
        alertMessage += `... and ${delayedOpenRequests.length - 5} more\n`;
      }
      alertMessage += '\n';
    }
    
    if (delayedInProgressRequests.length > 0) {
      alertMessage += `🕒 ${delayedInProgressRequests.length} in-progress request(s) delayed more than ${REMINDER_DAYS.IN_PROGRESS} days:\n`;
      delayedInProgressRequests.slice(0, 5).forEach(row => {
        alertMessage += `• #${row[0]} - ${row[2]} - ${formatDate(row[12])}\n`;
      });
      if (delayedInProgressRequests.length > 5) {
        alertMessage += `... and ${delayedInProgressRequests.length - 5} more\n`;
      }
      alertMessage += '\n';
    }
    
    if (highPriorityRequests.length > 0) {
      alertMessage += `🔥 ${highPriorityRequests.length} high priority request(s):\n`;
      highPriorityRequests.slice(0, 5).forEach(row => {
        alertMessage += `• #${row[0]} - ${row[4]} - ${row[2]} - ${formatDate(row[12])}\n`;
      });
      if (highPriorityRequests.length > 5) {
        alertMessage += `... and ${highPriorityRequests.length - 5} more\n`;
      }
      alertMessage += '\n';
    }
    
    if (unassignedRequests.length > 0) {
      alertMessage += `📝 ${unassignedRequests.length} unassigned request(s):\n`;
      unassignedRequests.slice(0, 5).forEach(row => {
        alertMessage += `• #${row[0]} - ${row[2]} - ${formatDate(row[12])}\n`;
      });
      if (unassignedRequests.length > 5) {
        alertMessage += `... and ${unassignedRequests.length - 5} more\n`;
      }
      alertMessage += '\n';
    }
    
    if (delayedOpenRequests.length === 0 && 
        delayedInProgressRequests.length === 0 && 
        highPriorityRequests.length === 0 && 
        unassignedRequests.length === 0) {
      alertMessage = '✅ No pending alerts! All maintenance requests are on track.';
    }
    
    // إرسال التنبيه
    sendMessage(chatId, alertMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
        ]
      }
    });
  } catch (err) {
    Logger.log(`checkPendingRequests error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error checking pending requests.');
  }
}

/**
 * تنسيق التاريخ للعرض
 */
function formatDate(dateValue) {
  try {
    if (!dateValue) return 'N/A';
    
    const date = new Date(dateValue);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  } catch (err) {
    return 'Invalid Date';
  }
}

/**
 * إرسال رابط التقرير على الويب
 */
function showWebReport(chatId) {
  try {
    // إنشاء تطبيق ويب بسيط
    const webAppUrl = ScriptApp.getService().getUrl();
    const reportUrl = webAppUrl + '?page=report';
    
    sendMessage(chatId, `📊 View detailed reports online:\n\n${reportUrl}\n\nThis link provides an interactive dashboard of all maintenance requests.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back to Admin Panel', callback_data: 'admin_panel' }]
        ]
      }
    });
  } catch (err) {
    Logger.log(`showWebReport error: ${err.message}\n${err.stack}`);
    sendMessage(chatId, '⚠️ Error generating web report link.');
  }
}

/**
 * تسجيل حدث في جدول التاريخ
 */
function recordTimeline(requestId, status, userId, comments, timestamp = new Date()) {
  try {
    // التحقق من وجود جدول التاريخ
    if (!timelineSheet) {
      Logger.log('Timeline sheet not initialized');
      return;
    }
    
    // تحويل معرف المستخدم إلى اسمه إن أمكن
    let updatedBy = getUserNameById(userId);
    if (!updatedBy) {
      updatedBy = String(userId);
    }
    
    // إضافة سجل جديد في جدول التاريخ
    timelineSheet.appendRow([
      requestId,
      status,
      updatedBy,
      comments,
      timestamp
    ]);
  } catch (err) {
    Logger.log(`recordTimeline error: ${err.message}\n${err.stack}`);
  }
}

/**
 * معالجة الحالات الإدارية المتقدمة
 */
function handleAdvancedAdminFlow(msg, chatId, userId, text, lower, state, userProps) {
  // التحقق من أن المستخدم مشرف أو فني
  if (!isAuthorized(userId)) {
    return false;
  }
  
  // معالجة الحالات المتقدمة
  if (state === STATES.AWAITING_ASSIGN_TECH) {
    // حالة تعيين فني
    handleTechAssignment(chatId, text, userProps);
    return true;
  }
  
  if (state === STATES.AWAITING_PRIORITY) {
    // حالة تحديد الأولوية
    handlePriorityAssignment(chatId, text, userProps);
    return true;
  }
  
  if (state === STATES.AWAITING_STATUS