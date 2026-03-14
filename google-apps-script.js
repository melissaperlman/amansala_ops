// ════════════════════════════════════════════════════════════════════════════
// AMANSALA OPERATIONS — Google Apps Script Backend
// Paste this entire file into Extensions → Apps Script in your Google Sheet.
// Deploy as Web App: Execute as Me, Access: Anyone
// ════════════════════════════════════════════════════════════════════════════

const SS = SpreadsheetApp.getActiveSpreadsheet();

// ── CORE UTILITIES ──────────────────────────────────────────────────────────

function getTab(name) {
  return SS.getSheetByName(name);
}

function tabToJSON(tabName) {
  const sheet = getTab(tabName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1)
    .filter(r => r[0] !== '' && r[0] !== null && r[0] !== undefined)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        // Convert Date objects to ISO strings
        if (val instanceof Date) val = val.toISOString();
        // Convert TRUE/FALSE to boolean
        if (val === true || val === 'TRUE') val = true;
        else if (val === false || val === 'FALSE') val = false;
        obj[h] = val;
      });
      return obj;
    });
}

function nextId(tabName) {
  const sheet = getTab(tabName);
  if (!sheet) return 1;
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 1;
  const ids = data.slice(1).map(r => Number(r[0])).filter(n => !isNaN(n) && n > 0);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function findRowById(tabName, id) {
  const sheet = getTab(tabName);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const headers = data[0];
      const obj = {};
      headers.forEach((h, j) => { obj[h] = data[i][j]; });
      return { sheet, rowIndex: i + 1, headers, data: data[i], obj };
    }
  }
  return null;
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function respondOk(data) {
  return respond({ success: true, data: data });
}

function respondError(error, errors) {
  const r = { success: false, error: error };
  if (errors) r.errors = errors;
  return respond(r);
}

function now() { return new Date().toISOString(); }

function toDateStr(d) {
  if (d instanceof Date) return Utilities.formatDate(d, 'America/Cancun', 'yyyy-MM-dd');
  if (typeof d === 'string' && d.length >= 10) return d.substring(0, 10);
  return String(d);
}

function toTimeStr(t) {
  if (t instanceof Date) return Utilities.formatDate(t, 'America/Cancun', 'HH:mm');
  return String(t);
}

function timeDiffMinutes(start, end) {
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// Write a row to a sheet given headers and an object
function appendRow(tabName, obj) {
  const sheet = getTab(tabName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sheet.appendRow(row);
  return obj;
}

function updateRow(tabName, rowIndex, headers, obj) {
  const sheet = getTab(tabName);
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return obj;
}

// ── SCHEMA HEADERS (for tab initialization/validation) ─────────────────────

const SCHEMAS = {
  retreats: ['id','name','week_start','week_end','status','notes','created_at'],
  groups: ['id','retreat_id','name','color','pax','arrival_date','departure_date','teacher_id','package_type','notes','status','created_at'],
  teachers: ['id','name','email','bio','instagram','website','preferred_rooms','typical_pax','notes','created_at'],
  schedule_templates: ['id','name','description','slots_json','created_at'],
  slots: ['id','group_id','day_date','slot_type','label','category','window_start','window_end','flex_minutes','requested_start','requested_end','requested_room','requested_name','noise_level','special_notes','confirmed_start','confirmed_end','confirmed_room','status','melissa_notes','required','created_at'],
  bookings: ['id','group_id','slot_id','day_date','start_time','end_time','title','subtitle','teacher_id','teacher_name','room','pax','category','status','price','is_optional','is_shared','setup_notes','notes','created_at','updated_at'],
  dietary: ['id','group_id','vegans','vegetarians','gluten_free','nut_allergy','shellfish_allergy','other_allergies','kitchen_notes','updated_at'],
  soul_services: ['id','retreat_id','service_type','name','facilitator','price_per_person','available_days','max_groups','notes','active'],
  form_submissions: ['id','group_id','token','status','submitted_at','form_data_json','vegans','vegetarians','gluten_free','allergies','needs_speaker','needs_mats','equipment_notes','general_notes','ip_address','created_at'],
  rs_groups: ['id','label','color','short','pax','lastDay','removed','created_at'],
  rs_bookings: ['id','group_id','day','start','end','title','subtitle','teacher','room','pax','notes','status','category','optional','price','created_at','updated_at'],
  rs_transport: ['id','group_id','room','fname','lname','flight','date','time','airport','coordinator','driver','rate','note','created_at']
};

const VALID_ROOMS = ['BF','Grande','Chica','Sky','Heaven'];
const LARGE_GROUP_BLOCKED_ROOMS = ['Sky','BF'];

// ── VALIDATION HELPERS ─────────────────────────────────────────────────────

function validateForeignKey(tabName, id, fieldName) {
  if (!id && id !== 0) return null; // optional FK
  const found = findRowById(tabName, id);
  if (!found) return 'Invalid ' + fieldName + ': no record with id ' + id;
  return null;
}

function validateSlotTimes(requestedStart, requestedEnd, windowStart, windowEnd, groupPax, room, dayDate, groupDepartureDate) {
  const errors = [];
  if (!requestedStart || !requestedEnd) return errors;

  const rs = String(requestedStart);
  const re = String(requestedEnd);
  const ws = String(windowStart);
  const we = String(windowEnd);

  if (ws && rs < ws) errors.push('Start time must be ' + ws + ' or later');
  if (we && re > we) errors.push('End time must be ' + we + ' or earlier');

  const dur = timeDiffMinutes(rs, re);
  if (dur < 45) errors.push('Class must be at least 45 minutes');
  if (dur > 180) errors.push('Class cannot exceed 3 hours');

  if (groupPax > 22 && room && LARGE_GROUP_BLOCKED_ROOMS.includes(room)) {
    errors.push('Your group size (' + groupPax + ') requires a larger shala. Sky and BF are unavailable.');
  }

  if (dayDate && groupDepartureDate && toDateStr(dayDate) === toDateStr(groupDepartureDate)) {
    if (re > '11:00') errors.push('Departure day classes must end by 11:00 AM');
  }

  return errors;
}

function checkMealProximity(dayDate, startTime, groupId) {
  // No class within 45 min of a meal end on the same day for same group
  const allSlots = tabToJSON('slots');
  const daySlots = allSlots.filter(s =>
    String(s.group_id) === String(groupId) &&
    toDateStr(s.day_date) === toDateStr(dayDate) &&
    s.slot_type === 'meal'
  );

  const startMin = timeToMinutes(startTime);

  for (const meal of daySlots) {
    const mealEnd = meal.confirmed_end || meal.requested_end;
    if (!mealEnd) continue;
    const mealEndMin = timeToMinutes(mealEnd);
    if (startMin > mealEndMin && (startMin - mealEndMin) < 45) {
      return 'This class starts too close to ' + meal.label + '. Move it to ' +
        minutesToTime(mealEndMin + 45) + ' or later.';
    }
  }
  return null;
}

function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function checkRoomConflict(dayDate, startTime, endTime, room, excludeBookingId) {
  if (!room || !VALID_ROOMS.includes(room)) return [];
  const allBookings = tabToJSON('bookings');
  const conflicts = [];

  const dd = toDateStr(dayDate);
  const st = String(startTime);
  const et = String(endTime);

  for (const b of allBookings) {
    if (excludeBookingId && String(b.id) === String(excludeBookingId)) continue;
    if (toDateStr(b.day_date) !== dd) continue;
    if (b.room !== room) continue;
    if (b.status === 'cancelled') continue;

    const bs = String(b.start_time);
    const be = String(b.end_time);

    // Overlap: a.start < b.end && a.end > b.start
    if (st < be && et > bs) {
      conflicts.push(b);
    }
  }
  return conflicts;
}

function getAvailableRooms(dayDate, startTime, endTime, excludeBookingId) {
  const available = [];
  for (const room of VALID_ROOMS) {
    const conflicts = checkRoomConflict(dayDate, startTime, endTime, room, excludeBookingId);
    if (conflicts.length === 0) available.push(room);
  }
  return available;
}

// ── SLOT → BOOKING PROMOTION ───────────────────────────────────────────────

function promoteSlotToBooking(slotId) {
  const slotRow = findRowById('slots', slotId);
  if (!slotRow) return { success: false, error: 'Slot not found' };
  const slot = slotRow.obj;

  const startTime = slot.confirmed_start || slot.requested_start;
  const endTime = slot.confirmed_end || slot.requested_end;
  const room = slot.confirmed_room || slot.requested_room;

  if (!startTime || !endTime) return { success: false, error: 'Slot has no time set' };

  // Get group info
  const groupRow = findRowById('groups', slot.group_id);
  const group = groupRow ? groupRow.obj : {};
  const teacherRow = group.teacher_id ? findRowById('teachers', group.teacher_id) : null;
  const teacher = teacherRow ? teacherRow.obj : {};

  // Check for existing booking for this slot
  const allBookings = tabToJSON('bookings');
  const existing = allBookings.find(b => String(b.slot_id) === String(slotId));

  // Room conflict check
  if (room) {
    const conflicts = checkRoomConflict(slot.day_date, startTime, endTime, room, existing ? existing.id : null);
    if (conflicts.length > 0) {
      return {
        success: false,
        error: 'Room conflict',
        conflict: { existing_booking: conflicts[0], requested: slot },
        available_rooms: getAvailableRooms(slot.day_date, startTime, endTime, existing ? existing.id : null)
      };
    }
  }

  const bookingObj = {
    id: existing ? existing.id : nextId('bookings'),
    group_id: slot.group_id,
    slot_id: slotId,
    day_date: slot.day_date,
    start_time: startTime,
    end_time: endTime,
    title: slot.requested_name || slot.label,
    subtitle: '',
    teacher_id: group.teacher_id || '',
    teacher_name: teacher.name || '',
    room: room || '',
    pax: group.pax || 0,
    category: slot.category || 'classes',
    status: 'confirmed',
    price: '',
    is_optional: false,
    is_shared: false,
    setup_notes: slot.special_notes || '',
    notes: slot.noise_level ? 'Noise: ' + slot.noise_level : '',
    created_at: existing ? existing.created_at : now(),
    updated_at: now()
  };

  if (existing) {
    const existingRow = findRowById('bookings', existing.id);
    updateRow('bookings', existingRow.rowIndex, existingRow.headers, bookingObj);
  } else {
    appendRow('bookings', bookingObj);
  }

  return { success: true, data: bookingObj };
}

// ── TEMPLATE EXPANSION ─────────────────────────────────────────────────────

function expandTemplateForGroup(templateId, groupId, arrivalDate) {
  const tmplRow = findRowById('schedule_templates', templateId);
  if (!tmplRow) return;

  const slotsJson = JSON.parse(tmplRow.obj.slots_json || '[]');
  const arrival = new Date(arrivalDate);

  for (const def of slotsJson) {
    const dayDate = new Date(arrival);
    dayDate.setDate(dayDate.getDate() + (def.day_offset - 1));

    const slotObj = {
      id: nextId('slots'),
      group_id: groupId,
      day_date: Utilities.formatDate(dayDate, 'America/Cancun', 'yyyy-MM-dd'),
      slot_type: def.slot_type,
      label: def.label,
      category: def.category || 'classes',
      window_start: def.window_start || '',
      window_end: def.window_end || '',
      flex_minutes: def.flex_minutes || 0,
      requested_start: def.default_start || '',
      requested_end: def.default_end || '',
      requested_room: '',
      requested_name: '',
      noise_level: '',
      special_notes: '',
      confirmed_start: '',
      confirmed_end: '',
      confirmed_room: '',
      status: 'pending',
      melissa_notes: '',
      required: def.required ? true : false,
      created_at: now()
    };

    appendRow('slots', slotObj);
  }
}

// ── GET HANDLER ────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'all';

    switch (action) {
      case 'all': {
        const retreatId = e.parameter.retreat_id;
        let groups = tabToJSON('groups');
        let bookings = tabToJSON('bookings');
        let dietary = tabToJSON('dietary');
        let slots = tabToJSON('slots');

        if (retreatId) {
          groups = groups.filter(g => String(g.retreat_id) === String(retreatId));
          const groupIds = groups.map(g => String(g.id));
          bookings = bookings.filter(b => groupIds.includes(String(b.group_id)) || b.is_shared);
          dietary = dietary.filter(d => groupIds.includes(String(d.group_id)));
          slots = slots.filter(s => groupIds.includes(String(s.group_id)));
        }

        const pendingSubmissions = tabToJSON('form_submissions').filter(s => s.status === 'submitted');

        return respondOk({
          retreats: tabToJSON('retreats'),
          groups: groups,
          teachers: tabToJSON('teachers'),
          bookings: bookings,
          dietary: dietary,
          slots: slots,
          soulServices: tabToJSON('soul_services'),
          pendingSubmissions: pendingSubmissions
        });
      }

      case 'formData': {
        const token = e.parameter.token;
        if (!token) return respondError('Missing token parameter');

        const submissions = tabToJSON('form_submissions');
        const sub = submissions.find(s => s.token === token);
        if (!sub) return respondError('Invalid token — this link is not valid');

        // Mark as opened if currently 'sent'
        if (sub.status === 'sent') {
          const subRow = findRowById('form_submissions', sub.id);
          if (subRow) {
            sub.status = 'opened';
            const idx = subRow.headers.indexOf('status');
            subRow.data[idx] = 'opened';
            subRow.sheet.getRange(subRow.rowIndex, idx + 1).setValue('opened');
          }
        }

        const alreadySubmitted = (sub.status === 'submitted' || sub.status === 'approved' || sub.status === 'declined');

        // Get group, teacher, slots, soul services
        const group = findRowById('groups', sub.group_id);
        if (!group) return respondError('Group not found for this token');

        const groupObj = group.obj;
        const teacherRow = groupObj.teacher_id ? findRowById('teachers', groupObj.teacher_id) : null;
        const teacher = teacherRow ? teacherRow.obj : { name: '', email: '' };

        const retreatRow = findRowById('retreats', groupObj.retreat_id);
        const retreat = retreatRow ? retreatRow.obj : {};

        const groupSlots = tabToJSON('slots').filter(s => String(s.group_id) === String(sub.group_id));
        const soulServices = tabToJSON('soul_services').filter(s =>
          String(s.retreat_id) === String(groupObj.retreat_id) && s.active !== false
        );

        // Room options (filtered by pax)
        const roomOptions = VALID_ROOMS.filter(r => {
          if (groupObj.pax > 22 && LARGE_GROUP_BLOCKED_ROOMS.includes(r)) return false;
          return true;
        });

        return respondOk({
          teacher: teacher,
          group: groupObj,
          retreat: retreat,
          slots: groupSlots,
          soulServices: soulServices,
          roomOptions: roomOptions,
          alreadySubmitted: alreadySubmitted,
          submissionData: alreadySubmitted ? sub : null
        });
      }

      case 'retreats':
        return respondOk(tabToJSON('retreats'));

      case 'teachers':
        return respondOk(tabToJSON('teachers'));

      case 'pendingForms':
        return respondOk(tabToJSON('form_submissions').filter(s => s.status === 'submitted'));

      // ── ROOM SCHEDULE ──────────────────────────────────────────
      case 'roomSchedule': {
        return respondOk({
          groups: tabToJSON('rs_groups'),
          bookings: tabToJSON('rs_bookings'),
          transport: tabToJSON('rs_transport')
        });
      }

      default:
        return respondError('Unknown action: ' + action);
    }
  } catch (err) {
    return respondError('Server error: ' + err.message);
  }
}

// ── POST HANDLER ───────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    switch (action) {

      // ── BOOKINGS ────────────────────────────────────────────────
      case 'saveBooking': {
        const b = payload;
        delete b.action;

        // FK validation
        if (b.group_id) {
          const fkErr = validateForeignKey('groups', b.group_id, 'group_id');
          if (fkErr) return respondError(fkErr);
        }

        // Room conflict check
        if (b.room && VALID_ROOMS.includes(b.room) && b.day_date && b.start_time && b.end_time) {
          const conflicts = checkRoomConflict(b.day_date, b.start_time, b.end_time, b.room, b.id);
          if (conflicts.length > 0 && b.status !== 'conflict') {
            return respond({
              success: false,
              error: 'Room conflict detected',
              conflict: conflicts[0],
              available_rooms: getAvailableRooms(b.day_date, b.start_time, b.end_time, b.id)
            });
          }
        }

        // Departure day check
        if (b.group_id && b.day_date && b.end_time) {
          const groupRow = findRowById('groups', b.group_id);
          if (groupRow && groupRow.obj.departure_date) {
            if (toDateStr(b.day_date) === toDateStr(groupRow.obj.departure_date) && b.end_time > '11:00') {
              if (b.category === 'classes') {
                return respondError('Departure day classes must end by 11:00 AM');
              }
            }
          }
        }

        b.updated_at = now();

        if (b.id) {
          // Update existing
          const existing = findRowById('bookings', b.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, b);
            updateRow('bookings', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        // New booking
        b.id = nextId('bookings');
        b.created_at = b.created_at || now();
        appendRow('bookings', b);
        return respondOk(b);
      }

      case 'deleteBooking': {
        const existing = findRowById('bookings', payload.id);
        if (!existing) return respondError('Booking not found');

        // Reset linked slot if any
        if (existing.obj.slot_id) {
          const slotRow = findRowById('slots', existing.obj.slot_id);
          if (slotRow) {
            const idx = slotRow.headers.indexOf('status');
            slotRow.sheet.getRange(slotRow.rowIndex, idx + 1).setValue('pending');
          }
        }

        existing.sheet.deleteRow(existing.rowIndex);
        return respondOk({ deleted: payload.id });
      }

      case 'bulkSaveBookings': {
        const results = [];
        const bookingsToSave = payload.bookings || [];

        for (const b of bookingsToSave) {
          b.id = nextId('bookings');
          b.created_at = b.created_at || now();
          b.updated_at = now();
          appendRow('bookings', b);
          results.push(b);
        }

        return respondOk({ saved: results.length, bookings: results });
      }

      case 'saveSetupNotes': {
        const existing = findRowById('bookings', payload.id);
        if (!existing) return respondError('Booking not found');

        const idx = existing.headers.indexOf('setup_notes');
        if (idx >= 0) {
          existing.sheet.getRange(existing.rowIndex, idx + 1).setValue(payload.setup_notes || '');
        }
        const updIdx = existing.headers.indexOf('updated_at');
        if (updIdx >= 0) {
          existing.sheet.getRange(existing.rowIndex, updIdx + 1).setValue(now());
        }

        return respondOk({ id: payload.id, setup_notes: payload.setup_notes });
      }

      // ── DIETARY ─────────────────────────────────────────────────
      case 'saveDietary': {
        const d = payload;
        delete d.action;
        d.updated_at = now();

        // Find existing by group_id
        const allDietary = tabToJSON('dietary');
        const existing = allDietary.find(r => String(r.group_id) === String(d.group_id));

        if (existing) {
          const row = findRowById('dietary', existing.id);
          if (row) {
            const merged = Object.assign({}, row.obj, d);
            updateRow('dietary', row.rowIndex, row.headers, merged);
            return respondOk(merged);
          }
        }

        // New
        d.id = nextId('dietary');
        appendRow('dietary', d);
        return respondOk(d);
      }

      // ── GROUPS ──────────────────────────────────────────────────
      case 'saveGroup': {
        const g = payload;
        delete g.action;

        // FK validations
        if (g.retreat_id) {
          const fkErr = validateForeignKey('retreats', g.retreat_id, 'retreat_id');
          if (fkErr) return respondError(fkErr);
        }
        if (g.teacher_id) {
          const fkErr = validateForeignKey('teachers', g.teacher_id, 'teacher_id');
          if (fkErr) return respondError(fkErr);
        }

        if (g.id) {
          // Update
          const existing = findRowById('groups', g.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, g);
            updateRow('groups', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        // New group
        g.id = nextId('groups');
        g.created_at = now();
        g.status = g.status || 'confirmed';
        appendRow('groups', g);

        // Auto-create dietary row
        const dietaryObj = {
          id: nextId('dietary'),
          group_id: g.id,
          vegans: 0,
          vegetarians: 0,
          gluten_free: 0,
          nut_allergy: 0,
          shellfish_allergy: 0,
          other_allergies: '',
          kitchen_notes: '',
          updated_at: now()
        };
        appendRow('dietary', dietaryObj);

        // Expand template into slots if retreat has a template
        if (g.retreat_id) {
          const retreat = findRowById('retreats', g.retreat_id);
          if (retreat && retreat.obj.template_id) {
            expandTemplateForGroup(retreat.obj.template_id, g.id, g.arrival_date);
          }
        }

        // If teacher specified, pre-fill from teacher profile
        if (g.teacher_id) {
          const teacher = findRowById('teachers', g.teacher_id);
          if (teacher && teacher.obj.typical_pax && !g.pax) {
            g.pax = teacher.obj.typical_pax;
          }
        }

        return respondOk(g);
      }

      // ── TEACHERS ────────────────────────────────────────────────
      case 'saveTeacher': {
        const t = payload;
        delete t.action;

        // Email uniqueness
        if (t.email) {
          const all = tabToJSON('teachers');
          const dup = all.find(x => x.email === t.email && String(x.id) !== String(t.id));
          if (dup) return respondError('A teacher with email ' + t.email + ' already exists (id: ' + dup.id + ')');
        }

        if (t.id) {
          const existing = findRowById('teachers', t.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, t);
            updateRow('teachers', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        t.id = nextId('teachers');
        t.created_at = now();
        appendRow('teachers', t);
        return respondOk(t);
      }

      // ── RETREATS ────────────────────────────────────────────────
      case 'saveRetreat': {
        const r = payload;
        delete r.action;

        if (r.id) {
          const existing = findRowById('retreats', r.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, r);
            updateRow('retreats', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        r.id = nextId('retreats');
        r.created_at = now();
        r.status = r.status || 'upcoming';
        appendRow('retreats', r);
        return respondOk(r);
      }

      // ── TEACHER FORM SUBMISSION ─────────────────────────────────
      case 'submitTeacherForm': {
        const token = payload.token;
        if (!token) return respondError('Missing token');

        // Find submission by token
        const allSubs = tabToJSON('form_submissions');
        const sub = allSubs.find(s => s.token === token);
        if (!sub) return respondError('Invalid token');

        if (sub.status === 'submitted' || sub.status === 'approved') {
          return respondError('This form has already been submitted.');
        }

        // Get group
        const groupRow = findRowById('groups', sub.group_id);
        if (!groupRow) return respondError('Group not found');
        const group = groupRow.obj;

        // Validate slot times from form data
        const formSlots = payload.slots || [];
        const errors = [];

        for (const fs of formSlots) {
          if (fs.slot_type === 'class' || fs.slot_type === 'ceremony') {
            const slotErrors = validateSlotTimes(
              fs.requested_start, fs.requested_end,
              fs.window_start, fs.window_end,
              group.pax, fs.requested_room,
              fs.day_date, group.departure_date
            );
            if (slotErrors.length > 0) {
              errors.push({ slot_id: fs.id, label: fs.label, day_date: fs.day_date, errors: slotErrors });
            }

            // Meal proximity check
            const mealErr = checkMealProximity(fs.day_date, fs.requested_start, sub.group_id);
            if (mealErr) {
              errors.push({ slot_id: fs.id, label: fs.label, day_date: fs.day_date, errors: [mealErr] });
            }
          }
        }

        if (errors.length > 0) {
          return respond({ success: false, error: 'Validation errors', errors: errors });
        }

        // Update slots with requested values
        for (const fs of formSlots) {
          const slotRow = findRowById('slots', fs.id);
          if (!slotRow) continue;
          const h = slotRow.headers;
          const updates = {
            requested_start: fs.requested_start || '',
            requested_end: fs.requested_end || '',
            requested_room: fs.requested_room || '',
            requested_name: fs.requested_name || '',
            noise_level: fs.noise_level || '',
            special_notes: fs.special_notes || ''
          };
          const merged = Object.assign({}, slotRow.obj, updates);
          updateRow('slots', slotRow.rowIndex, h, merged);
        }

        // Update the submission record
        const subRow = findRowById('form_submissions', sub.id);
        if (subRow) {
          const merged = Object.assign({}, subRow.obj, {
            status: 'submitted',
            submitted_at: now(),
            form_data_json: JSON.stringify(payload),
            vegans: payload.vegans || 0,
            vegetarians: payload.vegetarians || 0,
            gluten_free: payload.gluten_free || 0,
            allergies: payload.allergies || '',
            needs_speaker: payload.needs_speaker || false,
            needs_mats: payload.needs_mats || false,
            equipment_notes: payload.equipment_notes || '',
            general_notes: payload.general_notes || ''
          });
          updateRow('form_submissions', subRow.rowIndex, subRow.headers, merged);
        }

        return respondOk({ submitted: true });
      }

      // ── APPROVE SUBMISSION ──────────────────────────────────────
      case 'approveSubmission': {
        const subRow = findRowById('form_submissions', payload.submission_id);
        if (!subRow) return respondError('Submission not found');

        const sub = subRow.obj;
        if (sub.status === 'approved') return respondError('Already approved');

        // Parse form data
        const formData = JSON.parse(sub.form_data_json || '{}');

        // Get all slots for this group
        const groupSlots = tabToJSON('slots').filter(s => String(s.group_id) === String(sub.group_id));

        const promotionResults = [];
        const promotionErrors = [];

        for (const slot of groupSlots) {
          if (slot.status === 'confirmed') continue; // already done
          if (!slot.requested_start && !slot.confirmed_start) continue; // nothing to promote

          // If Melissa didn't override, use requested values as confirmed
          if (!slot.confirmed_start) {
            const sr = findRowById('slots', slot.id);
            if (sr) {
              const merged = Object.assign({}, sr.obj, {
                confirmed_start: slot.requested_start,
                confirmed_end: slot.requested_end,
                confirmed_room: slot.requested_room,
                status: 'confirmed'
              });
              updateRow('slots', sr.rowIndex, sr.headers, merged);
            }
          }

          const result = promoteSlotToBooking(slot.id);
          if (result.success) {
            promotionResults.push(result.data);
          } else {
            promotionErrors.push({ slot_id: slot.id, error: result.error, conflict: result.conflict });
          }
        }

        // Update dietary
        const dietaryRows = tabToJSON('dietary');
        const dietRow = dietaryRows.find(d => String(d.group_id) === String(sub.group_id));
        if (dietRow) {
          const dr = findRowById('dietary', dietRow.id);
          if (dr) {
            const merged = Object.assign({}, dr.obj, {
              vegans: sub.vegans || 0,
              vegetarians: sub.vegetarians || 0,
              gluten_free: sub.gluten_free || 0,
              other_allergies: sub.allergies || '',
              updated_at: now()
            });
            updateRow('dietary', dr.rowIndex, dr.headers, merged);
          }
        }

        // Mark submission approved
        const statusIdx = subRow.headers.indexOf('status');
        subRow.sheet.getRange(subRow.rowIndex, statusIdx + 1).setValue('approved');

        return respondOk({
          approved: true,
          bookings_created: promotionResults.length,
          bookings: promotionResults,
          errors: promotionErrors
        });
      }

      // ── APPROVE SINGLE SLOT ─────────────────────────────────────
      case 'approveSlot': {
        const slotRow = findRowById('slots', payload.slot_id);
        if (!slotRow) return respondError('Slot not found');

        const slot = slotRow.obj;
        const confirmStart = payload.confirmed_start || slot.requested_start;
        const confirmEnd = payload.confirmed_end || slot.requested_end;
        const confirmRoom = payload.confirmed_room || slot.requested_room;

        // Validate
        const groupRow = findRowById('groups', slot.group_id);
        const group = groupRow ? groupRow.obj : {};

        if (confirmRoom && group.pax > 22 && LARGE_GROUP_BLOCKED_ROOMS.includes(confirmRoom)) {
          return respondError('Group size (' + group.pax + ') too large for ' + confirmRoom);
        }

        if (slot.day_date && group.departure_date &&
            toDateStr(slot.day_date) === toDateStr(group.departure_date) &&
            confirmEnd > '11:00' && slot.slot_type === 'class') {
          return respondError('Departure day classes must end by 11:00 AM');
        }

        // Update slot
        const merged = Object.assign({}, slotRow.obj, {
          confirmed_start: confirmStart,
          confirmed_end: confirmEnd,
          confirmed_room: confirmRoom,
          status: 'confirmed',
          melissa_notes: payload.melissa_notes || slot.melissa_notes || ''
        });
        updateRow('slots', slotRow.rowIndex, slotRow.headers, merged);

        // Promote to booking
        const result = promoteSlotToBooking(payload.slot_id);
        return respond(result);
      }

      // ── DECLINE SUBMISSION ──────────────────────────────────────
      case 'declineSubmission': {
        const subRow = findRowById('form_submissions', payload.submission_id);
        if (!subRow) return respondError('Submission not found');

        const statusIdx = subRow.headers.indexOf('status');
        subRow.sheet.getRange(subRow.rowIndex, statusIdx + 1).setValue('declined');

        if (payload.note) {
          const notesIdx = subRow.headers.indexOf('general_notes');
          if (notesIdx >= 0) {
            const existing = subRow.obj.general_notes || '';
            subRow.sheet.getRange(subRow.rowIndex, notesIdx + 1).setValue(
              existing + (existing ? '\n' : '') + '[DECLINED] ' + payload.note
            );
          }
        }

        return respondOk({ declined: true });
      }

      // ── SEND FORM EMAIL ─────────────────────────────────────────
      case 'sendFormEmail': {
        const groupRow = findRowById('groups', payload.group_id);
        if (!groupRow) return respondError('Group not found');
        const group = groupRow.obj;

        if (!group.teacher_id) return respondError('No teacher assigned to this group');
        const teacherRow = findRowById('teachers', group.teacher_id);
        if (!teacherRow) return respondError('Teacher not found');
        const teacher = teacherRow.obj;
        if (!teacher.email) return respondError('Teacher has no email address');

        const retreatRow = findRowById('retreats', group.retreat_id);
        const retreat = retreatRow ? retreatRow.obj : {};

        // Generate token
        const token = Utilities.getUuid();

        // Create form_submissions record
        const subObj = {
          id: nextId('form_submissions'),
          group_id: group.id,
          token: token,
          status: 'sent',
          submitted_at: '',
          form_data_json: '',
          vegans: 0,
          vegetarians: 0,
          gluten_free: 0,
          allergies: '',
          needs_speaker: false,
          needs_mats: false,
          equipment_notes: '',
          general_notes: '',
          ip_address: '',
          created_at: now()
        };
        appendRow('form_submissions', subObj);

        // Build form URL — uses the teacher-form.html hosted location
        // The CONFIG.TEACHER_FORM_URL should be set by the operator
        const formBaseUrl = payload.form_base_url || 'https://melissaperlman.github.io/amansala_ops/teacher-form.html';
        const formUrl = formBaseUrl + '?token=' + token;

        // Send email
        const arrivalFormatted = group.arrival_date ? Utilities.formatDate(new Date(group.arrival_date), 'America/Cancun', 'EEEE, MMMM d, yyyy') : group.arrival_date;
        const departureFormatted = group.departure_date ? Utilities.formatDate(new Date(group.departure_date), 'America/Cancun', 'EEEE, MMMM d, yyyy') : group.departure_date;

        const subject = 'Your Amansala Schedule Form — ' + group.name + ', ' + arrivalFormatted;

        const body = 'Hi ' + teacher.name + ',\n\n' +
          'Please complete your schedule preferences for your upcoming retreat:\n\n' +
          '  ' + group.name + '  ·  ' + group.pax + ' guests\n' +
          '  Arrival: ' + arrivalFormatted + '  ·  Departure: ' + departureFormatted + '\n\n' +
          'Fill out your form here:\n' + formUrl + '\n\n' +
          'A few things to know:\n' +
          '· Class times can be adjusted within the time windows shown on the form\n' +
          '· Room assignments are confirmed by Melissa after reviewing the full week\n' +
          '· Soul services marked "Optional" allow your guests to opt in individually\n\n' +
          'Questions? melissa@amansala.com\n\n' +
          'With love,\nAmansala · Tulum';

        GmailApp.sendEmail(teacher.email, subject, body);

        return respondOk({ sent: true, token: token, email: teacher.email });
      }

      // ── SAVE SOUL SERVICE ───────────────────────────────────────
      case 'saveSoulService': {
        const s = payload;
        delete s.action;

        if (s.id) {
          const existing = findRowById('soul_services', s.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, s);
            updateRow('soul_services', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        s.id = nextId('soul_services');
        appendRow('soul_services', s);
        return respondOk(s);
      }

      // ── SAVE SCHEDULE TEMPLATE ──────────────────────────────────
      case 'saveTemplate': {
        const t = payload;
        delete t.action;

        if (t.id) {
          const existing = findRowById('schedule_templates', t.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, t);
            updateRow('schedule_templates', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        t.id = nextId('schedule_templates');
        t.created_at = now();
        appendRow('schedule_templates', t);
        return respondOk(t);
      }

      // ── ROOM SCHEDULE: SAVE GROUP ────────────────────────────
      case 'saveRsGroup': {
        const g = payload;
        delete g.action;

        if (g.id) {
          const existing = findRowById('rs_groups', g.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, g);
            updateRow('rs_groups', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        g.id = nextId('rs_groups');
        g.created_at = now();
        appendRow('rs_groups', g);
        return respondOk(g);
      }

      // ── ROOM SCHEDULE: SAVE BOOKING ─────────────────────────
      case 'saveRsBooking': {
        const b = payload;
        delete b.action;
        b.updated_at = now();

        if (b.id) {
          const existing = findRowById('rs_bookings', b.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, b);
            updateRow('rs_bookings', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        b.id = nextId('rs_bookings');
        b.created_at = b.created_at || now();
        appendRow('rs_bookings', b);
        return respondOk(b);
      }

      // ── ROOM SCHEDULE: DELETE BOOKING ───────────────────────
      case 'deleteRsBooking': {
        const existing = findRowById('rs_bookings', payload.id);
        if (!existing) return respondError('Booking not found');
        existing.sheet.deleteRow(existing.rowIndex);
        return respondOk({ deleted: payload.id });
      }

      // ── ROOM SCHEDULE: BULK SAVE BOOKINGS ───────────────────
      case 'bulkSaveRsBookings': {
        const results = [];
        const items = payload.bookings || [];
        for (const b of items) {
          b.id = nextId('rs_bookings');
          b.created_at = now();
          b.updated_at = now();
          appendRow('rs_bookings', b);
          results.push(b);
        }
        return respondOk({ saved: results.length, bookings: results });
      }

      // ── ROOM SCHEDULE: SAVE TRANSPORT ───────────────────────
      case 'saveRsTransport': {
        const t = payload;
        delete t.action;

        if (t.id) {
          const existing = findRowById('rs_transport', t.id);
          if (existing) {
            const merged = Object.assign({}, existing.obj, t);
            updateRow('rs_transport', existing.rowIndex, existing.headers, merged);
            return respondOk(merged);
          }
        }

        t.id = nextId('rs_transport');
        t.created_at = now();
        appendRow('rs_transport', t);
        return respondOk(t);
      }

      // ── ROOM SCHEDULE: BULK SAVE TRANSPORT ──────────────────
      case 'bulkSaveRsTransport': {
        const results = [];
        const items = payload.arrivals || [];
        for (const t of items) {
          t.id = nextId('rs_transport');
          t.created_at = now();
          appendRow('rs_transport', t);
          results.push(t);
        }
        return respondOk({ saved: results.length, arrivals: results });
      }

      // ── ROOM SCHEDULE: DELETE GROUP ─────────────────────────
      case 'deleteRsGroup': {
        const existing = findRowById('rs_groups', payload.id);
        if (!existing) return respondError('Group not found');
        // Delete group
        existing.sheet.deleteRow(existing.rowIndex);
        // Delete associated bookings
        const allBookings = tabToJSON('rs_bookings');
        const toDelete = allBookings.filter(b => String(b.group_id) === String(payload.id));
        for (let i = toDelete.length - 1; i >= 0; i--) {
          const row = findRowById('rs_bookings', toDelete[i].id);
          if (row) row.sheet.deleteRow(row.rowIndex);
        }
        // Delete associated transport
        const allTransport = tabToJSON('rs_transport');
        const tDelete = allTransport.filter(t => String(t.group_id) === String(payload.id));
        for (let i = tDelete.length - 1; i >= 0; i--) {
          const row = findRowById('rs_transport', tDelete[i].id);
          if (row) row.sheet.deleteRow(row.rowIndex);
        }
        return respondOk({ deleted: payload.id });
      }

      // ── ROOM SCHEDULE: FULL SYNC (replace all data) ─────────
      case 'syncRoomSchedule': {
        // Clear and re-populate all rs_ tabs with provided data
        const rsGroups = payload.groups || [];
        const rsBookings = payload.bookings || [];
        const rsTransport = payload.transport || [];

        // Clear existing data (keep headers)
        ['rs_groups','rs_bookings','rs_transport'].forEach(tabName => {
          const sheet = getTab(tabName);
          if (sheet && sheet.getLastRow() > 1) {
            sheet.deleteRows(2, sheet.getLastRow() - 1);
          }
        });

        // Write groups
        for (const g of rsGroups) {
          g.id = g.id || nextId('rs_groups');
          g.created_at = g.created_at || now();
          appendRow('rs_groups', g);
        }

        // Write bookings
        for (const b of rsBookings) {
          b.id = b.id || nextId('rs_bookings');
          b.created_at = b.created_at || now();
          b.updated_at = now();
          appendRow('rs_bookings', b);
        }

        // Write transport
        for (const t of rsTransport) {
          t.id = t.id || nextId('rs_transport');
          t.created_at = t.created_at || now();
          appendRow('rs_transport', t);
        }

        return respondOk({ groups: rsGroups.length, bookings: rsBookings.length, transport: rsTransport.length });
      }

      default:
        return respondError('Unknown action: ' + action);
    }
  } catch (err) {
    return respondError('Server error: ' + err.message);
  }
}

// ── TRIGGERS ───────────────────────────────────────────────────────────────

/**
 * Run daily at midnight (set up via Apps Script Triggers UI).
 * Auto-updates retreat statuses based on current date.
 */
function autoUpdateRetreatStatuses() {
  const retreats = tabToJSON('retreats');
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'America/Cancun', 'yyyy-MM-dd');

  for (const r of retreats) {
    if (r.status === 'cancelled') continue;

    const start = toDateStr(r.week_start);
    const end = toDateStr(r.week_end);
    let newStatus = r.status;

    if (todayStr >= start && todayStr <= end) {
      newStatus = 'active';
    } else if (todayStr > end) {
      newStatus = 'completed';
    } else {
      newStatus = 'upcoming';
    }

    if (newStatus !== r.status) {
      const row = findRowById('retreats', r.id);
      if (row) {
        const idx = row.headers.indexOf('status');
        row.sheet.getRange(row.rowIndex, idx + 1).setValue(newStatus);
      }
    }
  }
}

/**
 * Spreadsheet on-edit trigger.
 * Stamps updated_at on bookings edits.
 */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();

  if (name === 'bookings') {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const updIdx = headers.indexOf('updated_at');
    if (updIdx >= 0) {
      sheet.getRange(e.range.getRow(), updIdx + 1).setValue(now());
    }
  }
}

// ── INITIALIZATION ─────────────────────────────────────────────────────────

/**
 * Run once to create all tabs with correct headers if they don't exist.
 */
function initializeSheet() {
  for (const [tabName, headers] of Object.entries(SCHEMAS)) {
    let sheet = SS.getSheetByName(tabName);
    if (!sheet) {
      sheet = SS.insertSheet(tabName);
    }
    // Check if headers are set
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    if (!existing[0] || existing[0] === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
}

// ── SEED DATA ──────────────────────────────────────────────────────────────

/**
 * Run once to populate the Google Sheet with existing bookings from the
 * prototype ops scheduler. Call this from Apps Script after initializing.
 */
function seedInitialData() {
  initializeSheet();

  // ── Retreat ─────────────────────────────────────────────────────
  const retreatId = nextId('retreats');
  appendRow('retreats', {
    id: retreatId,
    name: 'March 2025 Week',
    week_start: '2025-03-21',
    week_end: '2025-03-27',
    status: 'completed',
    notes: 'Seed data from prototype',
    created_at: now()
  });

  // ── Teachers ────────────────────────────────────────────────────
  const teachers = [
    { name: 'Meghan Kinsey', email: '', bio: '', instagram: '', website: '', preferred_rooms: '["Chica","Heaven"]', typical_pax: 26, notes: '' },
    { name: 'Sam Applebee', email: '', bio: '', instagram: '', website: '', preferred_rooms: '["Heaven"]', typical_pax: 12, notes: '' },
    { name: 'Melissa', email: 'melissa@amansala.com', bio: 'Owner/Operator', instagram: 'amansalatulum', website: 'amansala.com', preferred_rooms: '["BF","Grande"]', typical_pax: 12, notes: 'Owner' },
    { name: 'I Am Woman TBD', email: '', bio: '', instagram: '', website: '', preferred_rooms: '["Heaven","Beachfront"]', typical_pax: 12, notes: 'TBD teacher for I Am Woman group' }
  ];

  const teacherIds = {};
  for (const t of teachers) {
    const id = nextId('teachers');
    t.id = id;
    t.created_at = now();
    appendRow('teachers', t);
    teacherIds[t.name] = id;
  }

  // ── Groups ──────────────────────────────────────────────────────
  const groups = [
    { name: "Meghan's Group", color: '#e8a5b0', pax: 26, arrival_date: '2025-03-21', departure_date: '2025-03-26', teacher_id: teacherIds['Meghan Kinsey'], package_type: 'all-inclusive', notes: '', status: 'confirmed', legacyId: 'meghan' },
    { name: 'I Am Woman', color: '#5b7fa6', pax: 12, arrival_date: '2025-03-22', departure_date: '2025-03-27', teacher_id: teacherIds['I Am Woman TBD'], package_type: 'all-inclusive', notes: '', status: 'confirmed', legacyId: 'iamwoman' },
    { name: 'Samantha Applebee', color: '#4a8c5c', pax: 12, arrival_date: '2025-03-21', departure_date: '2025-03-26', teacher_id: teacherIds['Sam Applebee'], package_type: 'all-inclusive', notes: '', status: 'confirmed', legacyId: 'sam' },
    { name: 'Hot Mamas', color: '#c47d3e', pax: 12, arrival_date: '2025-03-21', departure_date: '2025-03-26', teacher_id: teacherIds['Melissa'], package_type: 'all-inclusive', notes: '', status: 'confirmed', legacyId: 'hotmamas' }
  ];

  const groupIdMap = {}; // legacyId → new id
  const sharedGroupId = nextId('groups');
  // Create a virtual "all" group for shared bookings
  appendRow('groups', {
    id: sharedGroupId,
    retreat_id: retreatId,
    name: 'All Groups / Shared',
    color: '#9a9490',
    pax: 0,
    arrival_date: '2025-03-21',
    departure_date: '2025-03-27',
    teacher_id: '',
    package_type: '',
    notes: 'Shared bookings',
    status: 'confirmed',
    created_at: now()
  });
  groupIdMap['all'] = sharedGroupId;

  for (const g of groups) {
    const id = nextId('groups');
    const legacyId = g.legacyId;
    delete g.legacyId;
    g.id = id;
    g.retreat_id = retreatId;
    g.created_at = now();
    appendRow('groups', g);
    groupIdMap[legacyId] = id;
  }

  // ── Dietary ─────────────────────────────────────────────────────
  const dietaryData = {
    meghan: { vegans: 0, vegetarians: 0, gluten_free: 0, nut_allergy: 0, shellfish_allergy: 0, other_allergies: '', kitchen_notes: '' },
    iamwoman: { vegans: 0, vegetarians: 0, gluten_free: 0, nut_allergy: 0, shellfish_allergy: 0, other_allergies: '', kitchen_notes: '' },
    sam: { vegans: 0, vegetarians: 0, gluten_free: 0, nut_allergy: 0, shellfish_allergy: 0, other_allergies: '', kitchen_notes: '' },
    hotmamas: { vegans: 0, vegetarians: 12, gluten_free: 0, nut_allergy: 0, shellfish_allergy: 0, other_allergies: '', kitchen_notes: '' }
  };

  for (const [legacyId, d] of Object.entries(dietaryData)) {
    d.id = nextId('dietary');
    d.group_id = groupIdMap[legacyId];
    d.updated_at = now();
    appendRow('dietary', d);
  }

  // ── Day label to date mapping ───────────────────────────────────
  const dayMap = {
    'Sat 21': '2025-03-21',
    'Sun 22': '2025-03-22',
    'Mon 23': '2025-03-23',
    'Tue 24': '2025-03-24',
    'Wed 25': '2025-03-25',
    'Thu 26': '2025-03-26',
    'Fri 27': '2025-03-27'
  };

  // Map legacy teacher names to teacher IDs
  const teacherNameMap = {
    'Megan': teacherIds['Meghan Kinsey'],
    'Meghan': teacherIds['Meghan Kinsey'],
    'Jess': '',
    'Lauren': '',
    'Robin': '',
    'Sergio': '',
    'Sam Applebee': teacherIds['Sam Applebee'],
    'Melissa': teacherIds['Melissa'],
    'Maria & Gollo': '',
    'Kun y Darlene': '',
    '': ''
  };

  // ── All bookings from prototype ─────────────────────────────────
  const seedBookings = [
    // SATURDAY MARCH 21
    { id:1, group:'all', day:'Sat 21', start:'16:00', end:'16:30', title:'Welcome Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:4, group:'all', day:'Sat 21', start:'19:00', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:2, group:'meghan', day:'Sat 21', start:'17:00', end:'18:30', title:'Opening Yoga + Mobility', subtitle:'w/ Megan', teacher:'Megan', room:'Chica', pax:26, notes:'Mats provided', status:'confirmed', category:'classes' },
    { id:3, group:'all', day:'Sat 21', start:'18:30', end:'19:00', title:'Welcome Orientation', subtitle:'at Firepit', teacher:'', room:'Firepit', pax:0, notes:'Welcome drinks & intro', status:'confirmed', category:'soul' },
    { id:101, group:'sam', day:'Sat 21', start:'17:45', end:'19:00', title:'Opening Yoga | Orientation w Amansala', subtitle:'', teacher:'Sam Applebee', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },

    // SUNDAY MARCH 22
    { id:5, group:'all', day:'Sun 22', start:'06:30', end:'07:00', title:'All Group Sunrise on the Beach', subtitle:'', teacher:'', room:'Beach', pax:0, notes:'Coffee & tea bar', status:'confirmed', category:'soul' },
    { id:8, group:'all', day:'Sun 22', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:10, group:'all', day:'Sun 22', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:13, group:'all', day:'Sun 22', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:6, group:'meghan', day:'Sun 22', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:7, group:'meghan', day:'Sun 22', start:'09:00', end:'10:30', title:'Booty Bands', subtitle:'', teacher:'Jess', room:'Chica', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:9, group:'all', day:'Sun 22', start:'11:45', end:'14:15', title:'Tulum Ruins', subtitle:'', teacher:'', room:'', pax:0, notes:'Entry fee per group', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:11, group:'meghan', day:'Sun 22', start:'16:30', end:'18:00', title:'Afternoon Slow Flow Barre', subtitle:'', teacher:'Lauren', room:'Chica', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:12, group:'meghan', day:'Sun 22', start:'18:00', end:'19:30', title:'Cacao + Sound Healing Ceremony', subtitle:'All Group', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'soul' },
    { id:201, group:'iamwoman', day:'Sun 22', start:'14:30', end:'15:00', title:'Welcome Snack', subtitle:'', teacher:'', room:'', pax:12, notes:'Arrival day', status:'confirmed', category:'meals' },
    { id:202, group:'iamwoman', day:'Sun 22', start:'19:00', end:'19:30', title:'Opening Ceremony – Welcome Amansala', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:203, group:'iamwoman', day:'Sun 22', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:102, group:'sam', day:'Sun 22', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:103, group:'sam', day:'Sun 22', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:104, group:'sam', day:'Sun 22', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:106, group:'sam', day:'Sun 22', start:'18:00', end:'19:15', title:'Afternoon Yoga', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },

    // MONDAY MARCH 23
    { id:15, group:'all', day:'Mon 23', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:21, group:'all', day:'Mon 23', start:'19:30', end:'20:30', title:'Dinner', subtitle:'Late if Temazcal', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:14, group:'meghan', day:'Mon 23', start:'06:30', end:'07:00', title:'Sunrise Yoga', subtitle:'', teacher:'Megan', room:'Heaven', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:16, group:'meghan', day:'Mon 23', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:17, group:'meghan', day:'Mon 23', start:'11:15', end:'11:45', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:18, group:'all', day:'Mon 23', start:'11:45', end:'14:15', title:'Grande Cenote', subtitle:'Sam: INC · Others: $75', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:19, group:'meghan', day:'Mon 23', start:'17:00', end:'18:30', title:'CBG', subtitle:'', teacher:'Meghan', room:'Chica', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:20, group:'all', day:'Mon 23', start:'19:15', end:'22:00', title:'Temazcal', subtitle:'', teacher:'', room:'', pax:0, notes:'Bring towel & sandals · Meet reception 10 min early', status:'confirmed', category:'soul', price:'$85', optional:true },
    { id:204, group:'iamwoman', day:'Mon 23', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:205, group:'iamwoman', day:'Mon 23', start:'09:00', end:'10:00', title:'Class', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:206, group:'iamwoman', day:'Mon 23', start:'10:30', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:208, group:'iamwoman', day:'Mon 23', start:'17:00', end:'18:30', title:'Class', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:209, group:'iamwoman', day:'Mon 23', start:'19:30', end:'20:30', title:'Dinner on Beach', subtitle:'', teacher:'', room:'Beach', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:107, group:'sam', day:'Mon 23', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:108, group:'sam', day:'Mon 23', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:109, group:'sam', day:'Mon 23', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:111, group:'sam', day:'Mon 23', start:'15:00', end:'16:00', title:'Cooking Class', subtitle:'', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:112, group:'sam', day:'Mon 23', start:'18:00', end:'19:15', title:'Afternoon Yoga', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },

    // TUESDAY MARCH 24
    { id:29, group:'all', day:'Tue 24', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:33, group:'all', day:'Tue 24', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:22, group:'meghan', day:'Tue 24', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:23, group:'meghan', day:'Tue 24', start:'09:00', end:'10:30', title:'Pyramids', subtitle:'', teacher:'Jess', room:'Chica', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:24, group:'meghan', day:'Tue 24', start:'10:45', end:'11:45', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:26, group:'all', day:'Tue 24', start:'15:00', end:'16:00', title:'Ice Bath', subtitle:'', teacher:'', room:'', pax:0, notes:'Bring swimwear & towel', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:27, group:'meghan', day:'Tue 24', start:'17:00', end:'18:30', title:'Mat Pilates', subtitle:'', teacher:'Robin', room:'Chica', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:28, group:'meghan', day:'Tue 24', start:'18:30', end:'19:30', title:'All Group Salsa', subtitle:'w/ Sergio', teacher:'Sergio', room:'', pax:0, notes:'', status:'confirmed', category:'soul' },
    { id:210, group:'iamwoman', day:'Tue 24', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:211, group:'iamwoman', day:'Tue 24', start:'09:00', end:'10:00', title:'Class', subtitle:'', teacher:'', room:'Beachfront', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:212, group:'iamwoman', day:'Tue 24', start:'10:30', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:213, group:'all', day:'Tue 24', start:'11:45', end:'14:00', title:'Tulum Ruins', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:215, group:'iamwoman', day:'Tue 24', start:'17:00', end:'18:00', title:'Class', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:216, group:'all', day:'Tue 24', start:'19:15', end:'20:15', title:'Cacao + Sound Healing', subtitle:'w/ Kun y Darlene', teacher:'Kun y Darlene', room:'', pax:0, notes:'Sam: Included · Others: $65', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:114, group:'sam', day:'Tue 24', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:115, group:'sam', day:'Tue 24', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:116, group:'sam', day:'Tue 24', start:'10:45', end:'11:45', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:118, group:'sam', day:'Tue 24', start:'18:00', end:'19:00', title:'Afternoon Yoga', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },

    // WEDNESDAY MARCH 25
    { id:35, group:'all', day:'Wed 25', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:30, group:'meghan', day:'Wed 25', start:'06:30', end:'07:30', title:'Sunrise Breathwork', subtitle:'', teacher:'Robin', room:'Heaven', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:31, group:'meghan', day:'Wed 25', start:'07:30', end:'08:30', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:32, group:'meghan', day:'Wed 25', start:'09:00', end:'10:30', title:'CBG', subtitle:'', teacher:'Meghan', room:'Chica', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:34, group:'meghan', day:'Wed 25', start:'10:45', end:'11:45', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:36, group:'all', day:'Wed 25', start:'11:45', end:'14:15', title:'Mangroves Tour', subtitle:'', teacher:'', room:'', pax:0, notes:'No local entry fee', status:'confirmed', category:'tours', optional:true },
    { id:37, group:'all', day:'Wed 25', start:'15:00', end:'15:30', title:'Mayan Clay Ritual', subtitle:'', teacher:'', room:'', pax:0, notes:'Bring old swimwear & towel', status:'confirmed', category:'soul' },
    { id:38, group:'meghan', day:'Wed 25', start:'19:30', end:'22:00', title:'Offsite Dinner', subtitle:'Great night for Gitano', teacher:'', room:'Gitano', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:217, group:'iamwoman', day:'Wed 25', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:218, group:'iamwoman', day:'Wed 25', start:'09:00', end:'10:00', title:'Class', subtitle:'', teacher:'', room:'Beachfront', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:219, group:'iamwoman', day:'Wed 25', start:'10:30', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:220, group:'iamwoman', day:'Wed 25', start:'17:00', end:'18:00', title:'Class', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:221, group:'all', day:'Wed 25', start:'19:15', end:'22:00', title:'Temazcal', subtitle:'w/ Maria & Gollo', teacher:'Maria & Gollo', room:'', pax:0, notes:'Sam: Included · Others: $85 · Bring towel & sandals · Meet reception 10 min early', status:'confirmed', category:'soul', price:'$85', optional:true },
    { id:222, group:'iamwoman', day:'Wed 25', start:'19:30', end:'20:30', title:'Dinner', subtitle:'Late if Temazcal', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:120, group:'sam', day:'Wed 25', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:121, group:'sam', day:'Wed 25', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:122, group:'sam', day:'Wed 25', start:'10:45', end:'11:45', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:125, group:'sam', day:'Wed 25', start:'16:30', end:'17:30', title:'Afternoon Class', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:126, group:'sam', day:'Wed 25', start:'19:30', end:'21:00', title:'Special Set-Up Dinner', subtitle:'On-site celebration', teacher:'', room:'', pax:12, notes:'$45 per person', status:'confirmed', category:'meals', price:'$45' },
    { id:127, group:'sam', day:'Wed 25', start:'19:00', end:'19:30', title:'Salsa Class Before Dinner', subtitle:'', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'soul' },

    // THURSDAY MARCH 26
    { id:45, group:'all', day:'Thu 26', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:46, group:'all', day:'Thu 26', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:39, group:'meghan', day:'Thu 26', start:'06:30', end:'07:00', title:'Final Group Sunrise on Beach', subtitle:'', teacher:'', room:'Beach', pax:0, notes:'', status:'confirmed', category:'soul' },
    { id:40, group:'meghan', day:'Thu 26', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:41, group:'meghan', day:'Thu 26', start:'08:00', end:'09:30', title:'Pyramids or CBG', subtitle:'retreaters choice', teacher:'Meghan', room:'Heaven', pax:26, notes:'', status:'confirmed', category:'classes' },
    { id:42, group:'meghan', day:'Thu 26', start:'11:15', end:'12:30', title:'Brunch & Departures', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:223, group:'iamwoman', day:'Thu 26', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:224, group:'iamwoman', day:'Thu 26', start:'09:45', end:'10:45', title:'Class', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:225, group:'iamwoman', day:'Thu 26', start:'10:45', end:'11:45', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:226, group:'all', day:'Thu 26', start:'11:45', end:'14:00', title:'Mangroves Tour', subtitle:'', teacher:'', room:'', pax:0, notes:'No local entry fee', status:'confirmed', category:'tours', optional:true },
    { id:227, group:'all', day:'Thu 26', start:'15:30', end:'16:00', title:'Mayan Clay Ritual', subtitle:'', teacher:'', room:'', pax:0, notes:'Bring old swimwear & towel', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:228, group:'iamwoman', day:'Thu 26', start:'17:45', end:'18:45', title:'Class', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:229, group:'iamwoman', day:'Thu 26', start:'20:30', end:'21:30', title:'Closing Ceremony', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:128, group:'sam', day:'Thu 26', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:129, group:'sam', day:'Thu 26', start:'08:00', end:'09:00', title:'Morning Class', subtitle:'', teacher:'Sam Applebee', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:130, group:'sam', day:'Thu 26', start:'09:00', end:'10:00', title:'Full Breakfast & Departures', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },

    // FRIDAY MARCH 27
    { id:230, group:'iamwoman', day:'Fri 27', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:231, group:'iamwoman', day:'Fri 27', start:'09:00', end:'10:00', title:'Morning Class', subtitle:'', teacher:'', room:'Grande', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:232, group:'iamwoman', day:'Fri 27', start:'10:45', end:'11:45', title:'Brunch & Departures', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },

    // ADDITIONAL / CORRECTED
    { id:301, group:'meghan', day:'Tue 24', start:'19:30', end:'21:00', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:302, group:'meghan', day:'Thu 26', start:'19:30', end:'21:00', title:'Farewell Dinner', subtitle:'Special set-up', teacher:'', room:'', pax:0, notes:'Special set-up dinner', status:'confirmed', category:'meals' },
    { id:303, group:'iamwoman', day:'Tue 24', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'meals' },
    { id:306, group:'iamwoman', day:'Thu 26', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'meals' },
    { id:307, group:'iamwoman', day:'Fri 27', start:'09:00', end:'10:00', title:'Closing Circle', subtitle:'', teacher:'', room:'Heaven', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:308, group:'sam', day:'Sat 21', start:'16:00', end:'16:30', title:'Welcome Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:310, group:'sam', day:'Sat 21', start:'19:00', end:'20:30', title:'Welcome Dinner', subtitle:'', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'meals' },
    { id:311, group:'sam', day:'Sun 22', start:'19:00', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:312, group:'sam', day:'Mon 23', start:'19:30', end:'21:00', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:313, group:'sam', day:'Tue 24', start:'20:00', end:'21:00', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:315, group:'sam', day:'Thu 26', start:'10:45', end:'11:30', title:'Brunch & Departures', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:317, group:'sam', day:'Thu 26', start:'18:00', end:'19:00', title:'Closing Circle & Ceremony', subtitle:'', teacher:'', room:'Chica', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:318, group:'sam', day:'Thu 26', start:'19:30', end:'21:00', title:'Farewell Dinner', subtitle:'Special set-up', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'meals' },
    { id:319, group:'all', day:'Sun 22', start:'14:30', end:'15:00', title:'Afternoon Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:320, group:'all', day:'Mon 23', start:'14:30', end:'15:00', title:'Afternoon Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:321, group:'all', day:'Tue 24', start:'14:30', end:'15:00', title:'Afternoon Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:322, group:'all', day:'Wed 25', start:'14:30', end:'15:00', title:'Afternoon Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:323, group:'all', day:'Thu 26', start:'14:30', end:'15:00', title:'Afternoon Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },

    // HOT MAMAS
    { id:400, group:'hotmamas', day:'Sat 21', start:'16:00', end:'16:30', title:'Welcome Snack', subtitle:'All groups', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:401, group:'hotmamas', day:'Sat 21', start:'17:45', end:'19:00', title:'Opening Yoga', subtitle:'', teacher:'Melissa', room:'BF', pax:12, notes:'Noise: Low', status:'confirmed', category:'classes' },
    { id:402, group:'hotmamas', day:'Sat 21', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:403, group:'hotmamas', day:'Sun 22', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:404, group:'hotmamas', day:'Sun 22', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Melissa', room:'Chica', pax:12, notes:'Noise: Low', status:'confirmed', category:'classes' },
    { id:405, group:'hotmamas', day:'Sun 22', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:406, group:'hotmamas', day:'Sun 22', start:'11:45', end:'14:15', title:'Tulum Ruins', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $75 pp', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:407, group:'hotmamas', day:'Sun 22', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:408, group:'hotmamas', day:'Sun 22', start:'18:00', end:'19:15', title:'Afternoon Yoga', subtitle:'', teacher:'Melissa', room:'Sky', pax:12, notes:'Noise: Medium', status:'confirmed', category:'classes' },
    { id:409, group:'hotmamas', day:'Sun 22', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:410, group:'hotmamas', day:'Mon 23', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:411, group:'hotmamas', day:'Mon 23', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Melissa', room:'Grande', pax:12, notes:'Noise: High', status:'confirmed', category:'classes' },
    { id:412, group:'hotmamas', day:'Mon 23', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:413, group:'hotmamas', day:'Mon 23', start:'11:45', end:'14:15', title:'Grande Cenote', subtitle:'Prepaid / Included', teacher:'', room:'', pax:12, notes:'Included in package', status:'confirmed', category:'tours', price:'INC', optional:false },
    { id:414, group:'hotmamas', day:'Mon 23', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:415, group:'hotmamas', day:'Mon 23', start:'15:00', end:'16:00', title:'Cooking Class', subtitle:'Included', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:416, group:'hotmamas', day:'Mon 23', start:'18:00', end:'19:15', title:'Afternoon Yoga', subtitle:'', teacher:'Melissa', room:'Chica', pax:12, notes:'Noise: Low', status:'confirmed', category:'classes' },
    { id:417, group:'hotmamas', day:'Mon 23', start:'19:15', end:'21:30', title:'Temazcal', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $85 pp', status:'confirmed', category:'soul', price:'$85', optional:true },
    { id:418, group:'hotmamas', day:'Mon 23', start:'19:30', end:'20:30', title:'Dinner', subtitle:'Late if temazcal', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:419, group:'hotmamas', day:'Tue 24', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:420, group:'hotmamas', day:'Tue 24', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Melissa', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:421, group:'hotmamas', day:'Tue 24', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:422, group:'hotmamas', day:'Tue 24', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:423, group:'hotmamas', day:'Tue 24', start:'15:00', end:'16:00', title:'Ice Bath', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $65 pp', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:424, group:'hotmamas', day:'Tue 24', start:'18:00', end:'19:00', title:'Afternoon Yoga', subtitle:'', teacher:'Melissa', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:425, group:'hotmamas', day:'Tue 24', start:'19:15', end:'20:15', title:'Cacao + Sound Healing', subtitle:'Included', teacher:'', room:'', pax:12, notes:'Included in package', status:'confirmed', category:'soul', price:'INC', optional:false },
    { id:426, group:'hotmamas', day:'Tue 24', start:'20:30', end:'21:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:427, group:'hotmamas', day:'Wed 25', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:428, group:'hotmamas', day:'Wed 25', start:'09:30', end:'10:30', title:'Morning Class', subtitle:'', teacher:'Melissa', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:429, group:'hotmamas', day:'Wed 25', start:'10:45', end:'11:30', title:'Brunch', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:430, group:'hotmamas', day:'Wed 25', start:'11:45', end:'14:15', title:'Mangroves', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $75 pp', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:431, group:'hotmamas', day:'Wed 25', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:432, group:'hotmamas', day:'Wed 25', start:'15:00', end:'15:30', title:'Mayan Clay', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $65 pp', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:433, group:'hotmamas', day:'Wed 25', start:'16:30', end:'17:30', title:'Afternoon Class', subtitle:'', teacher:'Melissa', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:434, group:'hotmamas', day:'Wed 25', start:'19:00', end:'19:30', title:'Salsa Class', subtitle:'Special event', teacher:'', room:'', pax:12, notes:'', status:'confirmed', category:'soul' },
    { id:435, group:'hotmamas', day:'Wed 25', start:'19:30', end:'21:00', title:'Special Dinner', subtitle:'On-site · $45 pp', teacher:'', room:'', pax:12, notes:'$45 per person', status:'confirmed', category:'meals', price:'$45' },
    { id:436, group:'hotmamas', day:'Thu 26', start:'07:00', end:'08:00', title:'Light Breakfast', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:437, group:'hotmamas', day:'Thu 26', start:'08:00', end:'09:00', title:'Morning Class', subtitle:'', teacher:'Melissa', room:'', pax:12, notes:'', status:'confirmed', category:'classes' },
    { id:438, group:'hotmamas', day:'Thu 26', start:'09:00', end:'10:00', title:'Full Breakfast & Departures', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },

    // I AM WOMAN ADDITIONAL
    { id:500, group:'iamwoman', day:'Mon 23', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:501, group:'iamwoman', day:'Mon 23', start:'11:45', end:'14:00', title:'Grande Cenote Tour', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $75 pp', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:502, group:'iamwoman', day:'Tue 24', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:503, group:'iamwoman', day:'Tue 24', start:'11:45', end:'14:00', title:'Tulum Ruins Tour', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $75 pp', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:504, group:'iamwoman', day:'Tue 24', start:'15:00', end:'17:00', title:'Ice Bath', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $65 pp', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:505, group:'iamwoman', day:'Tue 24', start:'19:15', end:'20:15', title:'Cacao Ceremony', subtitle:'w/ Kun y Darlene', teacher:'Kun y Darlene', room:'', pax:12, notes:'Optional · $65 pp · w/ Kun y Darlene', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:506, group:'iamwoman', day:'Wed 25', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:507, group:'iamwoman', day:'Wed 25', start:'19:15', end:'22:00', title:'Temazcal', subtitle:'w/ Maria & Gollo', teacher:'Maria & Gollo', room:'', pax:12, notes:'Optional · $85 pp · Meet reception 10 min early · Bring towel & sandals', status:'confirmed', category:'soul', price:'$85', optional:true },
    { id:508, group:'iamwoman', day:'Wed 25', start:'19:30', end:'20:30', title:'Dinner', subtitle:'Late if Temazcal', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:509, group:'iamwoman', day:'Thu 26', start:'11:45', end:'14:00', title:'Mangroves Tour', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $75 pp', status:'confirmed', category:'tours', price:'$75', optional:true },
    { id:510, group:'iamwoman', day:'Thu 26', start:'14:30', end:'15:00', title:'Snack', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' },
    { id:511, group:'iamwoman', day:'Thu 26', start:'15:30', end:'16:00', title:'Mayan Clay', subtitle:'Optional', teacher:'', room:'', pax:12, notes:'Optional · $65 pp', status:'confirmed', category:'soul', price:'$65', optional:true },
    { id:512, group:'iamwoman', day:'Thu 26', start:'19:30', end:'20:30', title:'Dinner', subtitle:'', teacher:'', room:'', pax:0, notes:'', status:'confirmed', category:'meals' }
  ];

  // Convert legacy bookings to normalized schema
  for (const b of seedBookings) {
    const newGroupId = groupIdMap[b.group] || groupIdMap['all'];
    const teacherId = teacherNameMap[b.teacher] || '';

    const bookingObj = {
      id: nextId('bookings'),
      group_id: newGroupId,
      slot_id: '',
      day_date: dayMap[b.day] || '',
      start_time: b.start || '',
      end_time: b.end || '',
      title: b.title || '',
      subtitle: b.subtitle || '',
      teacher_id: teacherId,
      teacher_name: b.teacher || '',
      room: b.room || '',
      pax: b.pax || 0,
      category: b.category || 'classes',
      status: b.status || 'confirmed',
      price: b.price || '',
      is_optional: b.optional || false,
      is_shared: b.group === 'all',
      setup_notes: '',
      notes: b.notes || '',
      created_at: now(),
      updated_at: now()
    };

    appendRow('bookings', bookingObj);
  }

  // ── Schedule Templates ──────────────────────────────────────────
  const standardTemplate = {
    id: nextId('schedule_templates'),
    name: 'Standard 6-Night Retreat',
    description: 'Sat arrival, Thu departure: 2 classes/day, standard meals, soul services on days 3-5',
    slots_json: JSON.stringify([
      // Day 1 (Arrival)
      { day_offset: 1, slot_type: 'meal', label: 'Welcome Snack', window_start: '15:00', window_end: '17:00', default_start: '16:00', default_end: '16:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 1, slot_type: 'class', label: 'Opening Yoga', window_start: '16:00', window_end: '19:30', default_start: '17:00', default_end: '18:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 1, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      // Day 2
      { day_offset: 2, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 2, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'meal', label: 'Snack', window_start: '14:00', window_end: '16:00', default_start: '14:30', default_end: '15:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:30', default_start: '17:00', default_end: '18:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 2, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      // Days 3-5 (same pattern)
      { day_offset: 3, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 3, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'meal', label: 'Snack', window_start: '14:00', window_end: '16:00', default_start: '14:30', default_end: '15:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:30', default_start: '17:00', default_end: '18:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 3, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 4, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'meal', label: 'Snack', window_start: '14:00', window_end: '16:00', default_start: '14:30', default_end: '15:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:30', default_start: '17:00', default_end: '18:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 4, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 5, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 5, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 5, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 5, slot_type: 'meal', label: 'Snack', window_start: '14:00', window_end: '16:00', default_start: '14:30', default_end: '15:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 5, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:30', default_start: '17:00', default_end: '18:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 5, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      // Day 6 (Departure)
      { day_offset: 6, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 6, slot_type: 'class', label: 'Morning Class', window_start: '07:00', window_end: '11:00', default_start: '08:00', default_end: '09:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 6, slot_type: 'meal', label: 'Brunch & Departures', window_start: '09:00', window_end: '12:00', default_start: '10:00', default_end: '11:00', flex_minutes: 60, required: true, category: 'meals' }
    ]),
    created_at: now()
  };
  appendRow('schedule_templates', standardTemplate);

  const intensiveTemplate = {
    id: nextId('schedule_templates'),
    name: '5-Night Intensive',
    description: 'Sun arrival, Thu departure: 2 classes/day, condensed schedule',
    slots_json: JSON.stringify([
      { day_offset: 1, slot_type: 'meal', label: 'Welcome Snack', window_start: '14:00', window_end: '16:00', default_start: '14:30', default_end: '15:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 1, slot_type: 'class', label: 'Opening Session', window_start: '16:00', window_end: '19:00', default_start: '17:00', default_end: '18:30', flex_minutes: 60, required: true, category: 'classes' },
      { day_offset: 1, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 2, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:00', default_start: '16:00', default_end: '17:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 2, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 3, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:00', default_start: '16:00', default_end: '17:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 3, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 4, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 4, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:00', default_start: '16:00', default_end: '17:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 4, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 5, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 5, slot_type: 'class', label: 'Closing Class', window_start: '07:00', window_end: '11:00', default_start: '08:00', default_end: '09:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 5, slot_type: 'meal', label: 'Brunch & Departures', window_start: '09:00', window_end: '12:00', default_start: '10:00', default_end: '11:00', flex_minutes: 60, required: true, category: 'meals' }
    ]),
    created_at: now()
  };
  appendRow('schedule_templates', intensiveTemplate);

  const weekendTemplate = {
    id: nextId('schedule_templates'),
    name: 'Weekend Retreat',
    description: 'Fri arrival, Sun departure: 1-2 classes/day',
    slots_json: JSON.stringify([
      { day_offset: 1, slot_type: 'meal', label: 'Welcome Snack', window_start: '15:00', window_end: '17:00', default_start: '16:00', default_end: '16:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 1, slot_type: 'class', label: 'Opening Yoga', window_start: '16:00', window_end: '19:00', default_start: '17:00', default_end: '18:30', flex_minutes: 60, required: true, category: 'classes' },
      { day_offset: 1, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'class', label: 'Morning Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: true, category: 'classes' },
      { day_offset: 2, slot_type: 'meal', label: 'Brunch', window_start: '10:30', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 2, slot_type: 'class', label: 'Afternoon Class', window_start: '15:00', window_end: '19:00', default_start: '16:00', default_end: '17:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 2, slot_type: 'meal', label: 'Dinner', window_start: '19:00', window_end: '21:00', default_start: '19:30', default_end: '20:30', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'meal', label: 'Light Breakfast', window_start: '06:30', window_end: '08:30', default_start: '07:00', default_end: '08:00', flex_minutes: 60, required: true, category: 'meals' },
      { day_offset: 3, slot_type: 'class', label: 'Closing Class', window_start: '08:00', window_end: '11:00', default_start: '09:00', default_end: '10:30', flex_minutes: 90, required: false, category: 'classes' },
      { day_offset: 3, slot_type: 'meal', label: 'Brunch & Departures', window_start: '10:00', window_end: '12:00', default_start: '10:45', default_end: '11:45', flex_minutes: 60, required: true, category: 'meals' }
    ]),
    created_at: now()
  };
  appendRow('schedule_templates', weekendTemplate);

  // ── Soul Services for March retreat ─────────────────────────────
  const soulServices = [
    { service_type: 'soul', name: 'Temazcal', facilitator: 'Maria & Gollo', price_per_person: 85, available_days: '["2025-03-23","2025-03-25"]', max_groups: 3, notes: 'Bring towel & sandals · Meet reception 10 min early', active: true },
    { service_type: 'soul', name: 'Cacao Ceremony', facilitator: 'Kun y Darlene', price_per_person: 65, available_days: '["2025-03-24"]', max_groups: 3, notes: 'Evening event', active: true },
    { service_type: 'soul', name: 'Sound Healing', facilitator: 'Kun y Darlene', price_per_person: 0, available_days: '["2025-03-24"]', max_groups: 3, notes: 'Often paired with Cacao', active: true },
    { service_type: 'soul', name: 'Mayan Clay', facilitator: '', price_per_person: 65, available_days: '["2025-03-25","2025-03-26"]', max_groups: 3, notes: 'Bring old swimwear & towel', active: true },
    { service_type: 'soul', name: 'Ice Bath', facilitator: '', price_per_person: 65, available_days: '["2025-03-24"]', max_groups: 3, notes: 'Bring swimwear & towel · 2-hour session', active: true },
    { service_type: 'tour', name: 'Grande Cenote', facilitator: '', price_per_person: 75, available_days: '["2025-03-23"]', max_groups: 3, notes: '', active: true },
    { service_type: 'tour', name: 'Tulum Ruins', facilitator: '', price_per_person: 75, available_days: '["2025-03-22","2025-03-24"]', max_groups: 3, notes: 'Morning, ~2hr', active: true },
    { service_type: 'tour', name: 'Mangroves', facilitator: '', price_per_person: 75, available_days: '["2025-03-25","2025-03-26"]', max_groups: 3, notes: '', active: true }
  ];

  for (const s of soulServices) {
    s.id = nextId('soul_services');
    s.retreat_id = retreatId;
    appendRow('soul_services', s);
  }

  return 'Seed complete: 1 retreat, ' + teachers.length + ' teachers, ' + (groups.length + 1) + ' groups, ' + seedBookings.length + ' bookings, 3 templates, ' + soulServices.length + ' soul services';
}
