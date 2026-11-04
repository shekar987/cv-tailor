"use client";

// Wins (4 Nov 2026, Chunk 15): what got past a recruiter, all time. A funnel of four numbers
// is read best as four numbers, each with the step's conversion, so it is a row of figures and
// not a chart. Every rate is out of the row's own group and says its count. Rules: lib/closing.
import { useMemo } from "react";
import { HIGHEST_STAGE_LABELS, conversionBy, highestStage, reachedScreening, resultLine, sourceOf, winsFunnel, type Conversion } from "@/lib/closing";
import { ROW_STYLE_LABELS, rowStyle } from "@/lib/formatStyles/ids";

export type WinsRow = {
  id: string;
  company_name: string;
  role: string | null;
  status: string;
  stages_reached?: string[] | null;
  closed_at?: string | null;
  close_reason?: string | null;
  lesson?: string | null;
  source?: string | null;
  referral?: boolean | null;
  format_style?: string | null;
};

function GroupTable({ title, groups, note }: { title: string; groups: readonly Conversion[]; note?: string }) {
  return (
    <div className="winsGroup" data-wins-group={title}>
      <h3 className="label">{title}</h3>
      <table className="winsTable">
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Reached screening</th>
            <th scope="col">Rate</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.label} data-wins-group-row={g.label}>
              <td data-label="Group">{g.label}</td>
              <td data-label="Reached screening">{g.reached} of {g.submitted.toLocaleString("en-GB")}</td>
              <td data-label="Rate">{g.rate === null ? "Too few" : `${g.rate}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="fitEvidence">{note}</p>}
    </div>
  );
}

export default function WinsView({ rows, showStyle }: { rows: readonly WinsRow[]; showStyle: boolean }) {
  const funnel = useMemo(() => winsFunnel(rows), [rows]);
  const reached = useMemo(() => rows.filter(reachedScreening), [rows]);
  const bySource = useMemo(() => conversionBy(rows, sourceOf), [rows]);
  const byStyle = useMemo(() => conversionBy(rows, (r) => ROW_STYLE_LABELS[rowStyle(r.format_style)]), [rows]);
  return (
    <div className="winsView" data-wins>
      <ol className="winsFunnel" data-wins-funnel>
        {funnel.map((step) => (
          <li key={step.key} className="statTile" data-wins-step={step.key}>
            <span className="statTile__value" data-wins-count>{step.count.toLocaleString("en-GB")}</span>
            <span className="statTile__label">{step.label}</span>
            {step.fromPrevious !== null && <span className="winsConversion" data-wins-rate>{step.fromPrevious}% of the step before</span>}
          </li>
        ))}
      </ol>

      <div className="winsGroups">
        <GroupTable title="By source" groups={bySource} />
        {showStyle && <GroupTable title="By CV style" groups={byStyle} note="Rows with no style recorded are counted here and never read as either style." />}
      </div>

      <section className="winsReached">
        <h3 className="label">Reached next round ({reached.length})</h3>
        {reached.length === 0 ? (
          <p className="fitEvidence">Nothing yet. Every application that reaches screening or further is listed here for good, whatever happens next.</p>
        ) : (
          <div className="winsTableWrap">
            <table className="winsTable" data-wins-table>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Role</th>
                  <th scope="col">Highest stage</th>
                  <th scope="col">Result</th>
                  <th scope="col">Source</th>
                  {showStyle && <th scope="col">CV style</th>}
                  <th scope="col">Lesson</th>
                </tr>
              </thead>
              <tbody>
                {reached.map((row) => {
                  const stage = highestStage(row);
                  return (
                    <tr key={row.id} data-wins-row={row.company_name}>
                      <td data-label="Company">{row.company_name}</td>
                      <td data-label="Role">{row.role}</td>
                      <td data-label="Highest stage">{stage ? HIGHEST_STAGE_LABELS[stage] : ""}</td>
                      <td data-label="Result">{resultLine(row)}</td>
                      <td data-label="Source">{sourceOf(row)}</td>
                      {showStyle && <td data-label="CV style">{ROW_STYLE_LABELS[rowStyle(row.format_style)]}</td>}
                      <td data-label="Lesson">{row.lesson}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
