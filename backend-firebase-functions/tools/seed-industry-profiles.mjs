// One-time, idempotent seed for the Industry Configuration Engine's global
// catalog (industryProfiles/{id} + versions/v1). Data is inlined here
// (rather than imported from src/domain/industry-profiles.seed.ts) to avoid
// a build-order dependency on compiled lib/ output, matching this
// directory's existing tools (bootstrap-superadmin.mjs, seed-e2e.mjs). Keep
// the values below in sync with src/domain/industry-profiles.seed.ts by
// hand if either changes.
//
// Run against the live project:
//   node tools/seed-industry-profiles.mjs
//   node tools/seed-industry-profiles.mjs --dry-run
//
// Safe to re-run — every write uses { merge: true }.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

initializeApp({
  credential: applicationDefault(),
  projectId: 'atlanta-e04aa',
});
const db = getFirestore();

const PROFILES = [
  {
    id: 'generic_workforce',
    name: 'Generic Workforce',
    description: 'A general-purpose configuration for organizations that don\'t fit a specific vertical.',
    category: 'generic',
    version: {
      terminology: {
        workUnit: { singular: 'Shift', plural: 'Shifts' },
        workforceMember: { singular: 'Employee', plural: 'Employees' },
        department: { singular: 'Department', plural: 'Departments' },
        location: { singular: 'Location', plural: 'Locations' },
        marketplaceLabel: 'Staff Marketplace',
        scheduleLabel: 'Schedule',
      },
      workforceModel: {
        jobRoleCatalogId: null,
        supportsMultiRoleShifts: true,
        recommendedJobRoles: [
          { value: 'Associate', label: 'Associate' },
          { value: 'Clerk', label: 'Clerk' },
          { value: 'Assistant', label: 'Assistant' },
          { value: 'Technician', label: 'Technician' },
          { value: 'Operator', label: 'Operator' },
          { value: 'Driver', label: 'Driver' },
          { value: 'Supervisor', label: 'Supervisor' },
          { value: 'Manager', label: 'Manager' },
          { value: 'Admin', label: 'Admin' },
          { value: 'HR', label: 'HR' },
          { value: 'Other', label: 'Other' },
        ],
      },
      features: { recommendedPlanFeatures: [] },
      compliance: { regulatoryNotes: null },
      ai: { industryContextPrompt: 'You are the InnovaShift AI Copilot, an assistant embedded in a workforce scheduling app.' },
    },
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    description: 'Coordinate clinical and support staff, qualifications, coverage and compliance.',
    category: 'healthcare',
    version: {
      terminology: {
        workUnit: { singular: 'Shift', plural: 'Shifts' },
        workforceMember: { singular: 'Staff Member', plural: 'Staff' },
        department: { singular: 'Unit', plural: 'Units' },
        location: { singular: 'Facility', plural: 'Facilities' },
        marketplaceLabel: 'Open Shift Board',
        scheduleLabel: 'Schedule',
      },
      workforceModel: {
        jobRoleCatalogId: null,
        supportsMultiRoleShifts: true,
        recommendedJobRoles: [
          { value: 'RN', label: 'RN' },
          { value: 'CNA', label: 'CNA' },
          { value: 'LPN', label: 'LPN' },
          { value: 'Caregiver', label: 'Caregiver' },
          { value: 'NP', label: 'NP' },
          { value: 'MD', label: 'MD' },
          { value: 'Manager', label: 'Manager' },
          { value: 'Admin', label: 'Admin' },
          { value: 'HR', label: 'HR' },
          { value: 'Other', label: 'Other' },
        ],
      },
      features: { recommendedPlanFeatures: ['gpsAttendance'] },
      compliance: { regulatoryNotes: 'Recommended only — confirm licensure and credentialing requirements with your compliance team.' },
      ai: { industryContextPrompt: 'You are the InnovaShift AI Copilot, an assistant embedded in a healthcare workforce scheduling app. Shifts may require clinical licenses or certifications, and coverage/staffing-ratio language matters — use clinical and facility-appropriate framing.' },
    },
  },
  {
    id: 'education',
    name: 'Education',
    description: 'Plan teachers, administrators, substitutes, transport and campus staff.',
    category: 'education',
    version: {
      terminology: {
        workUnit: { singular: 'Class Session', plural: 'Class Sessions' },
        workforceMember: { singular: 'Instructor', plural: 'Instructors' },
        department: { singular: 'Program', plural: 'Programs' },
        location: { singular: 'Campus', plural: 'Campuses' },
        marketplaceLabel: 'Open Class Board',
        scheduleLabel: 'Class Schedule',
      },
      workforceModel: {
        jobRoleCatalogId: null,
        supportsMultiRoleShifts: true,
        recommendedJobRoles: [
          { value: 'Teacher', label: 'Teacher' },
          { value: 'Substitute Teacher', label: 'Substitute Teacher' },
          { value: 'Teaching Assistant', label: 'Teaching Assistant' },
          { value: 'Principal', label: 'Principal' },
          { value: 'Campus Manager', label: 'Campus Manager' },
          { value: 'Counselor', label: 'Counselor' },
          { value: 'Librarian', label: 'Librarian' },
          { value: 'Administrator', label: 'Administrator' },
          { value: 'Other', label: 'Other' },
        ],
      },
      features: { recommendedPlanFeatures: [] },
      compliance: { regulatoryNotes: 'Recommended only — confirm background-check and safeguarding requirements with your compliance team.' },
      ai: { industryContextPrompt: 'You are the InnovaShift AI Copilot, an assistant embedded in a school/campus staffing app. Staff are instructors, work units are class sessions, and locations are campuses — use education-appropriate framing.' },
    },
  },
  {
    id: 'restaurant_food_service',
    name: 'Restaurant & Food Service',
    description: 'Coordinate front-of-house, kitchen, managers, opening and closing coverage.',
    category: 'other',
    version: {
      terminology: {
        workUnit: { singular: 'Shift', plural: 'Shifts' },
        workforceMember: { singular: 'Team Member', plural: 'Team Members' },
        department: { singular: 'Station', plural: 'Stations' },
        location: { singular: 'Restaurant', plural: 'Restaurants' },
        marketplaceLabel: 'Open Shift Board',
        scheduleLabel: 'Schedule',
      },
      workforceModel: {
        jobRoleCatalogId: null,
        supportsMultiRoleShifts: true,
        recommendedJobRoles: [
          { value: 'General Manager', label: 'General Manager' },
          { value: 'Shift Manager', label: 'Shift Manager' },
          { value: 'Server', label: 'Server' },
          { value: 'Host', label: 'Host' },
          { value: 'Bartender', label: 'Bartender' },
          { value: 'Cook', label: 'Cook' },
          { value: 'Dishwasher', label: 'Dishwasher' },
          { value: 'Cashier', label: 'Cashier' },
          { value: 'Other', label: 'Other' },
        ],
      },
      features: { recommendedPlanFeatures: [] },
      compliance: { regulatoryNotes: 'Recommended only — confirm food-handler and alcohol-service certification requirements with your compliance team.' },
      ai: { industryContextPrompt: 'You are the InnovaShift AI Copilot, an assistant embedded in a restaurant staffing app. Staff are team members, and coverage often means opening/closing readiness and station coverage — use restaurant-appropriate framing.' },
    },
  },
];

const INERT_SECTIONS = {
  workforceModel: { jobRoleCatalogId: null, supportsMultiRoleShifts: true },
  scheduling: { defaultShiftLengthHours: null, overtimeRulesId: null },
  onboarding: { requiredDocumentTypeIds: [] },
  payroll: { notes: null },
  attendance: { geofenceStrictness: 'default' },
  navigation: { hiddenNavKeys: [] },
  dashboards: { widgetSetId: null, hiddenWidgetKeys: [] },
  ai: { industryContextPrompt: null },
};

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const now = FieldValue.serverTimestamp();

  for (const profile of PROFILES) {
    const profileRef = db.collection('industryProfiles').doc(profile.id);
    const versionRef = profileRef.collection('versions').doc('v1');

    const profileDoc = {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      category: profile.category,
      active: true,
      latestVersionId: 'v1',
      updatedAt: now,
    };
    const versionDoc = {
      versionId: 'v1',
      profileId: profile.id,
      status: 'published',
      ...INERT_SECTIONS,
      ...profile.version,
      updatedAt: now,
    };

    console.log(`[${dryRun ? 'DRY-RUN' : 'WRITE'}] industryProfiles/${profile.id} + versions/v1`);
    console.log(`  terminology.workUnit: ${versionDoc.terminology.workUnit.singular}/${versionDoc.terminology.workUnit.plural}`);

    if (!dryRun) {
      await profileRef.set(profileDoc, { merge: true });
      await versionRef.set(versionDoc, { merge: true });
    }
  }

  console.log(dryRun ? 'DRY RUN COMPLETE — no writes performed.' : 'SEED COMPLETE.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
