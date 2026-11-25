/**
 * What a bus parent's ride email contains. Every boarded / dropped-off email
 * carries two small support links: "Not expecting this?" (calls the school's
 * emergency line) and "Where is my child?" (the pupil's private bus page).
 * Pure function so the email sender and the Fleet preview share it (tested).
 */
import { busTrackPath } from "./bus";

export type RideNoticeKind = "pupil_boarded" | "pupil_dropped_off";

export interface RideEmailLink {
  label: string;
  href: string;
}

export interface RideEmail {
  subject: string;
  message: string;
  links: RideEmailLink[];
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, "")}`;

export function rideEmail(input: {
  kind: RideNoticeKind;
  message: string;
  childName: string;
  orgName: string;
  emergencyPhone: string | null | undefined;
  trackToken: string;
  siteUrl: string;
}): RideEmail {
  const boarded = input.kind === "pupil_boarded";
  const links: RideEmailLink[] = [];
  if (input.emergencyPhone?.trim())
    links.push({
      label: boarded
        ? "Not expecting this pick-up? Call the school"
        : "Not expecting this drop-off? Call the school",
      href: telHref(input.emergencyPhone),
    });
  links.push({
    label: "Where is my child?",
    href: `${input.siteUrl.replace(/\/$/, "")}${busTrackPath(input.trackToken)}`,
  });
  return {
    subject: boarded ? `${input.childName} is on the bus` : `${input.childName} is off the bus`,
    message: input.message,
    links,
  };
}
