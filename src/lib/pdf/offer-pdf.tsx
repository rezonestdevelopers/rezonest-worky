import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { Document, Font, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { OfferDocument } from "@/lib/offer-document";
import { getFile, mimeFor } from "@/lib/storage";

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
// The built-in PDF fonts have no ₹ sign, so the app's own font is embedded.
Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(FONT_DIR, "Geist-Regular.ttf"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "Geist-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const BRAND = "#d7202a";
const MUTED = "#5b6068";
const LINE = "#e3e5e8";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9, color: "#1b1d21", padding: 36, paddingBottom: 54, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  logo: { height: 30, width: 110, objectFit: "contain", objectPosition: "left", alignSelf: "flex-start", marginBottom: 6 },
  agencyName: { fontSize: 10, fontWeight: 700 },
  muted: { color: MUTED },
  docTitle: { fontSize: 16, fontWeight: 700, color: BRAND, textAlign: "right", lineHeight: 1.2, marginBottom: 4 },
  right: { textAlign: "right" },
  band: { flexDirection: "row", gap: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, paddingVertical: 8, marginBottom: 12 },
  bandCol: { flex: 1 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  strong: { fontWeight: 700 },
  title: { fontSize: 11, fontWeight: 700, marginBottom: 8 },
  tableHead: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 4, paddingHorizontal: 4, fontWeight: 700, fontSize: 8 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE, paddingVertical: 5, paddingHorizontal: 4 },
  cDesc: { flex: 1, paddingRight: 6 },
  cQty: { width: 50, textAlign: "right" },
  cRate: { width: 66, textAlign: "right" },
  cGst: { width: 30, textAlign: "right" },
  cTotal: { width: 70, textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 230, marginTop: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderColor: BRAND, marginTop: 4, paddingTop: 5, fontWeight: 700, fontSize: 11 },
  words: { marginTop: 6, fontSize: 8.5 },
  section: { marginTop: 12 },
  sectionTitle: { fontWeight: 700, marginBottom: 3 },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

export async function logoSrc(logoKey: string | null | undefined) {
  if (logoKey) {
    const file = await getFile(logoKey);
    if (file) return `data:${mimeFor(logoKey)};base64,${file.toString("base64")}`;
  }
  const file = await fs.readFile(path.join(process.cwd(), "public", "logo.png")).catch(() => null);
  return file ? `data:image/png;base64,${file.toString("base64")}` : null;
}

export async function renderOfferPdf(doc: OfferDocument, logoKey?: string | null): Promise<Buffer> {
  const logo = await logoSrc(logoKey);
  const a = doc.agency;
  const r = doc.recipient;
  return renderToBuffer(
    <Document title={`Quotation ${doc.number}`} author={a.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ flex: 1, paddingRight: 20 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt */}
            {logo && <Image src={logo} style={s.logo} />}
            <Text style={s.agencyName}>{a.name}</Text>
            <Text style={s.muted}>{[a.address, a.city, a.state, a.pincode].filter(Boolean).join(", ")}</Text>
            <Text style={s.muted}>{[a.phone, a.email, a.website].filter(Boolean).join(" · ")}</Text>
            {a.gstin && <Text style={s.muted}>GSTIN: {a.gstin}</Text>}
          </View>
          <View>
            <Text style={s.docTitle}>QUOTATION</Text>
            <Text style={[s.right, s.strong]}>{doc.number}{doc.version > 1 ? ` (v${doc.version})` : ""}</Text>
            <Text style={[s.right, s.muted]}>Date: {doc.offerDate}</Text>
            <Text style={[s.right, s.muted]}>Valid until: {doc.validUntil}</Text>
          </View>
        </View>

        <View style={s.band}>
          <View style={s.bandCol}>
            <Text style={s.label}>Prepared for</Text>
            <Text style={s.strong}>{r.name}</Text>
            {r.contact && <Text>{r.contact}</Text>}
            {r.address && <Text style={s.muted}>{r.address}</Text>}
          </View>
          <View style={s.bandCol}>
            {r.state && <Text style={s.muted}>Place of supply: {r.state}</Text>}
            {r.gstin && <Text style={s.muted}>GSTIN: {r.gstin}</Text>}
            {r.email && <Text style={s.muted}>{r.email}</Text>}
            {r.phone && <Text style={s.muted}>{r.phone}</Text>}
          </View>
        </View>

        <Text style={s.title}>{doc.title}</Text>

        <View style={s.tableHead} fixed>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cRate}>Rate</Text>
          <Text style={s.cGst}>GST</Text>
          <Text style={s.cTotal}>Amount</Text>
        </View>
        {doc.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <View style={s.cDesc}>
              <Text>{l.description}</Text>
              <Text style={[s.muted, { fontSize: 7.5 }]}>{l.details}</Text>
              {l.discount && <Text style={[s.muted, { fontSize: 7.5 }]}>Discount {l.discount}. Taxable {l.taxable}</Text>}
            </View>
            <Text style={s.cQty}>{l.quantity}</Text>
            <Text style={s.cRate}>{l.rate}</Text>
            <Text style={s.cGst}>{l.gst}</Text>
            <Text style={s.cTotal}>{l.total}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          {doc.summary.map((row) => (
            <View key={row.label} style={s.totalRow}>
              <Text style={s.muted}>{row.label}</Text>
              <Text>{row.value}</Text>
            </View>
          ))}
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{doc.grandTotal}</Text>
          </View>
        </View>
        <Text style={s.words}>Amount in words: {doc.amountInWords}</Text>
        {doc.taxNote && <Text style={[s.muted, { marginTop: 2 }]}>{doc.taxNote}</Text>}
        {doc.retainerNote && <Text style={[s.muted, { marginTop: 2 }]}>{doc.retainerNote}</Text>}

        {doc.milestones.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Payment milestones (one-time work, before GST)</Text>
            {doc.milestones.map((m, i) => (
              <View key={i} style={s.totalRow}>
                <Text>{m.name} ({m.percent})</Text>
                <Text>{m.amount}</Text>
              </View>
            ))}
          </View>
        )}
        {doc.paymentTerms && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Payment terms</Text>
            <Text>{doc.paymentTerms}</Text>
          </View>
        )}
        {doc.notes && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text>{doc.notes}</Text>
          </View>
        )}
        {doc.terms && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Terms &amp; conditions</Text>
            <Text style={s.muted}>{doc.terms}</Text>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{a.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>,
  );
}

export const pdfFileName = (number: string) => `${number.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
