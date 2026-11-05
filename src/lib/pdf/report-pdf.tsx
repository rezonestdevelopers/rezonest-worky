import "server-only";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCell, type ReportDoc, type ReportSection } from "@/lib/reports";
import { formatDateKey, todayKey } from "@/lib/dates";
import { logoSrc } from "./offer-pdf";

const BRAND = "#d7202a";
const MUTED = "#5b6068";
const LINE = "#e3e5e8";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 8, color: "#1b1d21", padding: 30, paddingBottom: 44, lineHeight: 1.3 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  logo: { height: 28, width: 104, objectFit: "contain", objectPosition: "left", marginBottom: 4 },
  agency: { fontSize: 9, fontWeight: 700 },
  title: { fontSize: 14, fontWeight: 700, color: BRAND, textAlign: "right", lineHeight: 1.2 },
  subtitle: { color: MUTED, textAlign: "right", marginTop: 2 },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, paddingVertical: 7, marginBottom: 8 },
  summaryLabel: { fontSize: 7, color: MUTED },
  summaryValue: { fontSize: 10, fontWeight: 700 },
  section: { marginTop: 10 },
  sectionTitle: { fontSize: 9.5, fontWeight: 700, marginBottom: 2 },
  note: { fontSize: 7, color: MUTED, marginBottom: 3 },
  head: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 3, paddingHorizontal: 3, fontWeight: 700, fontSize: 7 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE, paddingVertical: 3, paddingHorizontal: 3 },
  total: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, fontWeight: 700 },
  empty: { color: MUTED, paddingVertical: 2 },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

const isNumeric = (kind?: string) => kind === "money" || kind === "number" || kind === "percent";

function Section({ section }: { section: ReportSection }) {
  const prose = section.columns.length === 1 && !section.columns[0].label;
  const style = (i: number) => {
    const c = section.columns[i];
    const numeric = isNumeric(c.kind);
    return { flex: c.weight ?? (numeric || c.kind === "date" ? 1 : 2), textAlign: numeric ? ("right" as const) : ("left" as const), paddingRight: 4 };
  };
  return (
    <View style={s.section}>
      <View wrap={false} minPresenceAhead={30}>
        <Text style={s.sectionTitle}>{section.title}</Text>
        {section.note && <Text style={s.note}>{section.note}</Text>}
      </View>
      {prose ? (
        section.rows.map((r, i) => <Text key={i}>{String(r[0] ?? "")}</Text>)
      ) : section.rows.length === 0 ? (
        <Text style={s.empty}>{section.empty ?? "Nothing to show."}</Text>
      ) : (
        <>
          <View style={s.head} fixed={false}>
            {section.columns.map((c, i) => <Text key={i} style={style(i)}>{c.label}</Text>)}
          </View>
          {section.rows.map((r, n) => (
            <View key={n} style={s.row} wrap={false}>
              {r.map((v, i) => <Text key={i} style={style(i)}>{formatCell(section.columns[i]?.kind, v)}</Text>)}
            </View>
          ))}
          {section.total && (
            <View style={s.total} wrap={false}>
              {section.total.map((v, i) => <Text key={i} style={style(i)}>{v === null ? "" : formatCell(section.columns[i]?.kind, v)}</Text>)}
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** Any report. The figures come from the same cells the screen shows, so the two always match. */
export async function renderReportPdf(doc: ReportDoc, agency: { name: string; contact?: string | null; logoKey?: string | null }): Promise<Buffer> {
  const logo = await logoSrc(agency.logoKey);
  return renderToBuffer(
    <Document title={`${doc.title} ${doc.subtitle}`} author={agency.name}>
      <Page size="A4" orientation={doc.landscape ? "landscape" : "portrait"} style={s.page}>
        <View style={s.header}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt */}
            {logo && <Image src={logo} style={s.logo} />}
            <Text style={s.agency}>{agency.name}</Text>
            {agency.contact && <Text style={{ color: MUTED }}>{agency.contact}</Text>}
          </View>
          <View style={{ maxWidth: "60%" }}>
            <Text style={s.title}>{doc.title}</Text>
            <Text style={s.subtitle}>{doc.subtitle}</Text>
          </View>
        </View>
        {doc.summary && doc.summary.length > 0 && (
          <View style={s.summary}>
            {doc.summary.map((x) => (
              <View key={x.label}>
                <Text style={s.summaryLabel}>{x.label}</Text>
                <Text style={s.summaryValue}>{x.value}</Text>
              </View>
            ))}
          </View>
        )}
        {doc.sections.map((section) => <Section key={section.title} section={section} />)}
        <View style={s.footer} fixed>
          <Text>{agency.name} · Generated {formatDateKey(todayKey())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>,
  );
}
