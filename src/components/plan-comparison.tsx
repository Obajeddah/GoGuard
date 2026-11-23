import { Check, Minus } from "lucide-react";
import { EXTRA_BRANCH_NAIRA, formatNaira, PLAN_IDS, PLANS, TRIAL_DAYS } from "@/lib/billing";

const ROWS: { group: string; rows: { label: string; values: [string | boolean, string | boolean, string | boolean] }[] }[] = [
  { group: "Plan limits", rows: [
    { label: "Monthly price", values: [formatNaira(PLANS.basic.amountNaira), formatNaira(PLANS.standard.amountNaira), formatNaira(PLANS.group.amountNaira)] },
    { label: "School branches", values: ["1", "1", "Up to 3"] },
    { label: "School buses", values: ["0", "Up to 4", "Up to 6"] },
    { label: "Free trial", values: [`${TRIAL_DAYS} days`, false, false] },
    { label: "Additional branches", values: [false, false, `${formatNaira(EXTRA_BRANCH_NAIRA)}/month each beyond 3`] },
  ] },
  { group: "Gate & attendance", rows: [
    { label: "QR gate scanning", values: [true, true, true] },
    { label: "Guardian photo verification", values: [true, true, true] },
    { label: "Gate guard interface", values: [true, true, true] },
    { label: "Parent & guardian registration link", values: [true, true, true] },
    { label: "Up to 4 guardians per student", values: [true, true, true] },
    { label: "Parent email alerts", values: [true, true, true] },
    { label: "Automatic class attendance", values: [true, true, true] },
    { label: "CSV & Excel reports", values: [true, true, true] },
  ] },
  { group: "School transport", rows: [
    { label: "Fleet management & school map", values: [false, true, true] },
    { label: "Bus mobile app", values: [false, true, true] },
    { label: "Offline bus record queue", values: [false, true, true] },
    { label: "Boarding & drop-off records", values: [false, true, true] },
    { label: "Bus parent alerts & last-seen page", values: [false, true, true] },
  ] },
  { group: "Branch management", rows: [
    { label: "Branch-isolated access", values: [false, false, true] },
    { label: "Headquarters branch switcher", values: [false, false, true] },
    { label: "Branch & class filtered exports", values: [false, false, true] },
  ] },
];

export function PlanComparison() {
  return (
    <section className="mt-16 border-t border-border pt-12" aria-labelledby="comparison-title">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Full comparison</p>
      <h2 id="comparison-title" className="mt-3 text-3xl font-bold">What’s included in each plan.</h2>
      <div className="mt-8 max-w-full overflow-x-auto" role="region" aria-label="Scrollable plan comparison">
        <table className="w-full min-w-[650px] border-collapse text-sm">
          <thead><tr className="border-b-2 border-border">
            <th scope="col" className="w-2/5 py-5 pr-4 text-left font-medium text-muted-foreground">Features</th>
            {PLAN_IDS.map((id) => <th scope="col" key={id} className="px-3 py-5 text-center font-display text-base text-primary">{PLANS[id].label}</th>)}
          </tr></thead>
          {ROWS.map((group) => <tbody key={group.group}>
            <tr><th colSpan={4} scope="colgroup" className="bg-secondary/50 px-3 py-3 text-left font-semibold">{group.group}</th></tr>
            {group.rows.map((row) => <tr key={row.label} className="border-b border-border">
              <th scope="row" className="py-4 pr-4 text-left font-normal">{row.label}</th>
              {row.values.map((value, i) => <td key={i} className="px-3 py-4 text-center">
                {typeof value === "boolean" ? value
                  ? <><Check className="mx-auto size-5 text-checkin" aria-hidden /><span className="sr-only">Included</span></>
                  : <><Minus className="mx-auto size-4 text-muted-foreground" aria-hidden /><span className="sr-only">Not included</span></>
                  : value}
              </td>)}
            </tr>)}
          </tbody>)}
        </table>
      </div>
    </section>
  );
}