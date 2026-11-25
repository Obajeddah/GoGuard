export type OrgType = "school" | "estate" | "corporate";

export interface OrgTerms {
  /** Tab / type label shown on Register and Sign in. */
  label: string;
  orgNoun: string;
  member: string;
  members: string;
  identifier: string;
  identifierPlaceholder: string;
  owner: string;
  ownerEmail: string;
  guardian: string;
  guardians: string;
  registerTitle: string;
  registerIntro: string;
  checkIn: string;
  checkOut: string;
  checkInHint: string;
  checkOutHint: string;
  relationships: string[];
}

export const ORG_TERMS: Record<OrgType, OrgTerms> = {
  school: {
    label: "School",
    orgNoun: "school",
    member: "Student",
    members: "Students",
    identifier: "Class",
    identifierPlaceholder: "e.g. Year 3B",
    owner: "Parent",
    ownerEmail: "Parent email",
    guardian: "Guardian",
    guardians: "Guardians",
    registerTitle: "Register your child's trusted guardians",
    registerIntro:
      "Add up to four people you trust to drop off and pick up your child. Each person receives a personal QR pass to show at the gate.",
    checkIn: "Check in",
    checkOut: "Check out",
    checkInHint: "Drop-off",
    checkOutHint: "Pick-up",
    relationships: [
      "Mother",
      "Father",
      "Grandparent",
      "Aunt",
      "Uncle",
      "Sibling",
      "Nanny",
      "Driver",
    ],
  },
  estate: {
    label: "Estate",
    orgNoun: "estate",
    member: "Resident",
    members: "Residents",
    identifier: "Unit / house",
    identifierPlaceholder: "e.g. Block C, Flat 4",
    owner: "Resident",
    ownerEmail: "Resident email",
    guardian: "Authorised person",
    guardians: "Authorised people",
    registerTitle: "Register your household's authorised people",
    registerIntro:
      "Add up to four people allowed through the gate on your behalf. Each person receives a personal QR pass.",
    checkIn: "Check in",
    checkOut: "Check out",
    checkInHint: "Entry",
    checkOutHint: "Exit",
    relationships: ["Spouse", "Child", "Relative", "Housekeeper", "Driver", "Tenant"],
  },
  corporate: {
    label: "Industry",
    orgNoun: "company",
    member: "Employee",
    members: "Employees",
    identifier: "Department",
    identifierPlaceholder: "e.g. Operations",
    owner: "Employee",
    ownerEmail: "Employee email",
    guardian: "Authorised contact",
    guardians: "Authorised contacts",
    registerTitle: "Register your authorised contacts",
    registerIntro:
      "Add up to four people allowed to collect or escort you on site. Each person receives a personal QR pass.",
    checkIn: "Check in",
    checkOut: "Check out",
    checkInHint: "Arrival",
    checkOutHint: "Departure",
    relationships: ["Self", "Spouse", "Relative", "Colleague", "Driver"],
  },
};

export function termsFor(type: OrgType | null | undefined): OrgTerms {
  return ORG_TERMS[type ?? "school"];
}

export const MAX_GUARDIANS = 4;
