import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchShare, DEMO } from "./store.js";
import { shareItems, groupShare, fmtDate, todayISO, bucketOf } from "./logic.js";

/* Read-only live page for a person or group. Data comes from get_share() — open, non-private items only. */

function demoShare(t) {
  try {
    const rows = Object.values(JSON.parse(localStorage.getItem("workbench-work-demo") || "{}"));
    const pick = (k) => Object.fromEntries(rows.filter((r) => r.kind === k).map((r) => [r.id, { ...r.data, id: r.id }]));
    const share = pick("share")[t];
    if (!share || share.revoked) return null;
    const people = pick("person");
    return {
      label: share.label,
      layout: share.layout,
      people: share.person_ids.map((id) => ({ id, name: people[id]?.name })),
      items: shareItems(pick("item"), people, share.person_ids),
    };
  } catch (e) {
    return null;
  }
}

function SharePage() {
  const t = new URLSearchParams(location.search).get("t") || "";
  const [data, setData] = useState(undefined);
  const [layout, setLayout] = useState(null);
  useEffect(() => {
    (DEMO ? Promise.resolve(demoShare(t)) : fetchShare(t)).then(setData).catch(() => setData(null));
  }, [t]);
  if (data === undefined) return <div className="splash">Loading…</div>;
  if (!data)
    return (
      <div className="share-page">
        <h1>Link not found</h1>
        <p className="muted">This link may have been reset or turned off. Ask Ben or Justin for a new one.</p>
      </div>
    );
  const today = todayISO();
  const lay = layout || data.layout || "person";
  const ids = data.people.map((p) => p.id);
  const peopleMap = Object.fromEntries(data.people.map((p) => [p.id, p]));
  const groups = groupShare(data.items, peopleMap, ids, ids.length > 1 ? lay : "person");
  const over = data.items.filter((i) => i.due && i.due < today).length;
  return (
    <div className="share-page">
      <div className="sp-head">
        <div className="eyebrow">Open items · updated live</div>
        <h1>{data.label}</h1>
        <div className="muted">
          {data.items.length} open{over ? ` · ${over} overdue` : ""} · as of {fmtDate(today, { dow: true })}
        </div>
        {ids.length > 1 && (
          <div className="seg">
            <button className={"seg-b" + (lay === "person" ? " on" : "")} onClick={() => setLayout("person")}>
              By person
            </button>
            <button className={"seg-b" + (lay === "stream" ? " on" : "")} onClick={() => setLayout("stream")}>
              By workstream
            </button>
          </div>
        )}
      </div>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.title} className="sp-group">
              {(ids.length > 1 || lay === "stream") && <h2>{g.title}</h2>}
              {g.items.map((it) => {
                const b = bucketOf(it.due, today);
                return (
                  <div key={it.id} className={"sp-item b-" + b}>
                    <div className="sp-t">{it.title}</div>
                    <div className="sp-m">
                      {it.due ? <span className={"due " + (b === "overdue" ? "over" : "")}>{b === "overdue" ? "Overdue · was due " : "Due "}{fmtDate(it.due)}</span> : <span className="muted">No deadline</span>}
                      <span className="muted">{(lay === "stream" && ids.length > 1 ? it.path.slice(2) : it.path).join(" › ")}</span>
                      {(ids.length > 1 || it.owners.length > 1) && <span className="muted">· {it.owners.join(", ")}</span>}
                    </div>
                    {it.description && <div className="sp-d">{it.description}</div>}
                    {it.blockers
                      .filter((x) => !x.done)
                      .map((x, i) => (
                        <div key={i} className="sp-w">
                          ⏳ Waiting on: {x.title}
                          {x.owners.length ? ` (${x.owners.join(", ")})` : ""}
                          {x.due ? `, due ${fmtDate(x.due)}` : ""}
                        </div>
                      ))}
                  </div>
                );
              })}
            </section>
          )
      )}
      {!data.items.length && <p className="muted">Nothing open right now 🎉</p>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<SharePage />);
