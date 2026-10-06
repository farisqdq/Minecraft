import type { UiAccent, UiLayout, UiTheme } from "@/lib/appearance";
import styles from "./preview.module.css";

/**
 * A miniature, live mock of a layout's frame and Overview — drawn in HTML
 * and CSS, not a screenshot, so it shows the person's current mode and
 * accent. Its colours are its own (preview.module.css), because the page's
 * tokens belong to whichever layout the person is in right now.
 */
export default function LayoutPreview({
  layout,
  theme,
  accent,
}: {
  layout: UiLayout;
  theme: UiTheme;
  accent: UiAccent | null;
}) {
  return (
    <span className={styles.pv} data-l={layout} data-mode={theme} data-a={accent ?? undefined} aria-hidden="true">
      {layout === "classic" && <Classic />}
      {layout === "command" && <Command />}
      {layout === "ledger" && <Ledger />}
      {layout === "board" && <Board />}
    </span>
  );
}

const lines = (n: number, cls = styles.row) =>
  Array.from({ length: n }, (_, i) => (
    <span key={i} className={cls}>
      <span className={styles.txt} style={{ width: `${46 - ((i * 13) % 20)}%` }} />
      <span className={`${styles.txt} ${styles.num}`} />
    </span>
  ));

function Classic() {
  return (
    <span className={styles.classic}>
      <span className={styles.topbar}>
        <span className={styles.mark} />
        <span className={styles.brandSerif}>Rent Roll</span>
        <span className={styles.tabs}>
          <span className={`${styles.tabPill} ${styles.tabOn}`} />
          <span className={styles.tabPill} />
          <span className={styles.tabPill} />
          <span className={styles.tabPill} />
        </span>
      </span>
      <span className={styles.body}>
        <span className={styles.titleSerif}>Overview</span>
        <span className={styles.cards3}>
          <span className={styles.card}><span className={styles.bigNum} /></span>
          <span className={styles.card}><span className={styles.bigNum} /></span>
          <span className={styles.card}><span className={styles.bigNum} /></span>
        </span>
        <span className={styles.panel}>{lines(3)}</span>
      </span>
    </span>
  );
}

function Command() {
  return (
    <span className={styles.command}>
      <span className={styles.sidebar}>
        <span className={styles.sideBrand}>
          <span className={styles.mark} />
        </span>
        <span className={`${styles.sideItem} ${styles.sideOn}`} />
        <span className={styles.sideItem} />
        <span className={styles.sideItem} />
        <span className={styles.sideItem} />
        <span className={styles.sideItem} />
      </span>
      <span className={styles.body}>
        <span className={styles.titleSans}>Overview</span>
        <span className={styles.kpis}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={styles.kpi}>
              <span className={styles.kpiLabel} />
              <span className={styles.kpiValue} />
            </span>
          ))}
        </span>
        <span className={styles.split}>
          <span className={styles.table}>
            <span className={styles.thead} />
            {lines(4, styles.trow)}
          </span>
          <span className={styles.rail}>
            <span className={styles.railItem} />
            <span className={styles.railItem} />
            <span className={styles.railItem} />
          </span>
        </span>
      </span>
    </span>
  );
}

function Ledger() {
  return (
    <span className={styles.ledger}>
      <span className={styles.slimbar}>
        <span className={styles.mark} />
        <span className={styles.slimLinks}>
          <span className={`${styles.slimLink} ${styles.slimOn}`} />
          <span className={styles.slimLink} />
          <span className={styles.slimLink} />
        </span>
      </span>
      <span className={styles.body}>
        <span className={styles.bigLabel} />
        <span className={styles.hero}>$48,250</span>
        <span className={styles.progress}>
          <span className={styles.progressFill} />
        </span>
        <span className={styles.group}>
          <span className={styles.groupHead} />
          {lines(2, styles.trow)}
          <span className={styles.groupHead} />
          {lines(2, styles.trow)}
        </span>
      </span>
    </span>
  );
}

function Board() {
  const cols = [
    { cls: styles.late, n: 2 },
    { cls: styles.vacant, n: 1 },
    { cls: styles.ended, n: 1 },
    { cls: styles.paid, n: 3 },
  ];
  return (
    <span className={styles.board}>
      <span className={styles.iconRail}>
        <span className={styles.mark} />
        <span className={`${styles.railDot} ${styles.railDotOn}`} />
        <span className={styles.railDot} />
        <span className={styles.railDot} />
        <span className={styles.railDot} />
      </span>
      <span className={styles.body}>
        <span className={styles.titleSans}>Overview</span>
        <span className={styles.columns}>
          {cols.map((c, i) => (
            <span key={i} className={styles.column}>
              <span className={`${styles.colHead} ${c.cls}`} />
              {Array.from({ length: c.n }, (_, j) => (
                <span key={j} className={styles.tile}>
                  <span className={styles.txt} style={{ width: "70%" }} />
                  <span className={styles.txt} style={{ width: "40%" }} />
                </span>
              ))}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
