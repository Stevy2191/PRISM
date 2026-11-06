// Starter forms and playbooks (Playbooks, PB, task 10), seeded once into a
// new or upgraded install for each organization to copy and edit. They are
// vendor-neutral on purpose: no MDM, carrier, vendor or product is named, so
// they fit any install (a test checks this). Device-specific steps use
// conditions on the device (managed, cellular), never product names.
//
// Shared by migration 081 (which seeds them) and the starters test.

const step = (key, body, extra = {}) => ({ key, kind: 'step', body: `<p>${body}</p>`, required: true, ...extra });
const ifManaged = [{ on: 'device', field: 'isManaged', op: 'is', value: true }];
const ifUnmanaged = [{ on: 'device', field: 'isManaged', op: 'is', value: false }];
const ifCellular = [{ on: 'device', field: 'hasCellular', op: 'is', value: true }];

const FORMS = [
  {
    ref: 'device-check-out',
    name: 'Device check-out',
    description: 'Set up a device and hand it to the person it is for.',
    usage: 'device',
    definition: {
      sections: [
        {
          key: 'start',
          title: 'Before you start',
          items: [
            step('have_device', 'You have the device, its charger and its serial number.'),
            step('know_person', 'You know who the device is for and which department they are in.'),
          ],
        },
        {
          key: 'record',
          title: 'Record the device',
          items: [
            { key: 'serial', kind: 'field', fieldType: 'text', label: 'Serial number', required: true },
            { key: 'condition', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['New', 'Good', 'Fair'], required: true },
          ],
        },
        {
          key: 'setup',
          title: 'Set up the device',
          items: [
            step('enrolled', 'Confirm the device is enrolled in your device management and assigned to the person.', { showWhen: ifManaged }),
            step('apps', "Install the apps and settings the person's department needs."),
            { key: 'agent', kind: 'agent', body: '<p>The PRISM agent is installed and reporting in.</p>' },
            step('line', 'Confirm the phone line is active, and note its number on the device.', { showWhen: ifCellular }),
          ],
        },
        {
          key: 'handover',
          title: 'Hand it over',
          items: [
            step('signin', 'The person signs in and sets their own password or passcode.'),
            { key: 'check_out', kind: 'action', action: 'check_out' },
          ],
        },
      ],
    },
  },
  {
    ref: 'device-check-in',
    name: 'Device check-in',
    description: 'Take a device back, erase it and get it ready for the next person.',
    usage: 'device',
    definition: {
      sections: [
        {
          key: 'receive',
          title: 'Receive the device',
          items: [
            step('have_device', 'You have the device and its charger.'),
            { key: 'condition', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['Good', 'Damaged', 'Missing parts'], required: true },
          ],
        },
        {
          key: 'keep',
          title: 'Before erasing',
          items: [
            { key: 'hold', kind: 'field', fieldType: 'yesno', label: 'Is any data on it under a retention requirement or legal hold?', required: true },
            step('copied', 'Copy anything that must be kept to where your records policy says, and get approval before erasing.', { showWhen: [{ on: 'answer', field: 'hold', op: 'is', value: true }] }),
            { key: 'approved_by', kind: 'field', fieldType: 'staff', label: 'Who approved erasing it', required: true },
          ],
        },
        {
          key: 'erase',
          title: 'Erase the device',
          items: [
            step('erase_managed', 'Erase it from your device management while it is still enrolled. Don\'t remove it from device management first.', { showWhen: ifManaged }),
            step('erase_local', 'Erase it on the device itself.', { showWhen: ifUnmanaged }),
            { key: 'unlock_code', kind: 'secure', label: 'Unlock or bypass code, if one was needed' },
            step('setup_screen', 'Confirm the device restarts to its setup screen with no lock from the previous person.'),
          ],
        },
        {
          key: 'records',
          title: 'Accounts and records',
          items: [
            { key: 'leaving', kind: 'field', fieldType: 'yesno', label: 'Is the person leaving the organization?', required: true },
            step('remove_access', "Remove the person's sign-ins and assignments tied to this device.", { showWhen: [{ on: 'answer', field: 'leaving', op: 'is', value: true }] }),
            step('line', 'Cancel the phone line, or move it to the next person, with the carrier.', { showWhen: ifCellular }),
          ],
        },
        {
          key: 'ready',
          title: 'Mark it ready',
          items: [
            step('clean', 'Clean the device, charge it and store it with its charger.'),
            { key: 'check_in', kind: 'action', action: 'check_in', statuses: ['ready_to_issue', 'in_repair', 'on_hold', 'retired'] },
          ],
        },
      ],
    },
  },
  {
    ref: 'new-account',
    name: 'New account',
    description: 'Accounts and access for someone joining.',
    usage: 'ticket',
    definition: {
      sections: [
        {
          key: 'details',
          title: 'Details',
          items: [
            { key: 'start_date', kind: 'field', fieldType: 'date', label: 'Start date', required: true },
            { key: 'username', kind: 'field', fieldType: 'text', label: 'Username', required: true },
          ],
        },
        {
          key: 'account',
          title: 'Account',
          items: [
            step('directory', 'Create the directory account with their name, department and manager.'),
            step('mailbox', 'Create their mailbox.'),
            step('licenses', 'Assign the licenses their role needs.'),
            step('groups', 'Add them to the groups and shared resources for their department and role.'),
            { key: 'temp_password', kind: 'secure', label: 'Temporary password' },
            step('send', 'Send the sign-in details to the person or their manager.'),
          ],
        },
      ],
    },
  },
  {
    ref: 'account-termination',
    name: 'Account termination',
    description: 'Accounts and access for someone leaving.',
    usage: 'ticket',
    definition: {
      sections: [
        {
          key: 'before',
          title: 'Before the last day',
          items: [
            { key: 'last_day', kind: 'field', fieldType: 'date', label: 'Last working day', required: true },
            step('handover', "Confirm the last day and who takes over the person's work."),
          ],
        },
        {
          key: 'account',
          title: 'Account',
          items: [
            step('disable', 'Disable the directory account.'),
            step('sessions', 'Sign the person out of every session.'),
            step('licenses', 'Remove their licenses.'),
            step('mailbox', 'Convert the mailbox or set up forwarding, as your policy says.'),
            step('files', "Give the person's manager access to the files that must be kept."),
            step('groups', 'Remove them from groups and shared resources.'),
          ],
        },
        {
          key: 'devices',
          title: 'Devices',
          items: [
            { key: 'devices_note', kind: 'text', body: "<p>Each of the person's devices has its own check-in form on this ticket.</p>" },
          ],
        },
      ],
    },
  },
];

const PLAYBOOKS = [
  {
    name: 'New account',
    description: 'Someone is joining: their accounts, and a check-out form for each device added to the ticket.',
    needsPerson: false,
    blocks: [
      { form: 'new-account', applies: 'once', limits: {} },
      { form: 'device-check-out', applies: 'ticket_devices', limits: {} },
    ],
  },
  {
    name: 'Account termination',
    description: 'Someone is leaving: account clean-up, then every device they hold checked back in.',
    needsPerson: true,
    blocks: [
      { form: 'account-termination', applies: 'once', limits: {} },
      { form: 'device-check-in', applies: 'person_devices', limits: {} },
    ],
  },
];

module.exports = { FORMS, PLAYBOOKS };
