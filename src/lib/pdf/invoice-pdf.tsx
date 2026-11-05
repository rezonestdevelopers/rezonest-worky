import "server-only";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { formatDateKey } from "@/lib/dates";
import { upiLink } from "@/lib/invoice-rules";
import type { InvoiceDocument } from "@/lib/invoice-document";
import { amountInWords, formatINR, toDecimal, type DecimalLike } from "@/lib/money";
import { getFile, mimeFor } from "@/lib/storage";
import { logoSrc, pdfFileName } from "./offer-pdf";

export { pdfFileName };

const BRAND = "#d7202a";
const MUTED = "#5b6068";
const LINE = "#e3e5e8";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 8.5, color: "#1b1d21", padding: 32, paddingBottom: 50, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  logo: { height: 30, width: 110, objectFit: "contain", objectPosition: "left", alignSelf: "flex-start", marginBottom: 6 },
  agencyName: { fontSize: 10, fontWeight: 700 },
  muted: { color: MUTED },
  docTitle: { fontSize: 15, fontWeight: 700, color: BRAND, textAlign: "right", lineHeight: 1.2, marginBottom: 4 },
  right: { textAlign: "right" },
  band: { flexDirection: "row", gap: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, paddingVertical: 8, marginBottom: 10 },
  bandCol: { flex: 1 },
  label: { fontSize: 7, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  strong: { fontWeight: 700 },
  tableHead: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 4, paddingHorizontal: 3, fontWeight: 700, fontSize: 7.5 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE, paddingVertical: 4, paddingHorizontal: 3, fontSize: 8 },
  cDesc: { flex: 1, paddingRight: 4 },
  cSac: { width: 38 },
  cQty: { width: 38, textAlign: "right" },
  cRate: { width: 58, textAlign: "right" },
  cTaxable: { width: 60, textAlign: "right" },
  cGst: { width: 28, textAlign: "right" },
  cTax: { width: 52, textAlign: "right" },
  cTotal: { width: 62, textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 230, marginTop: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderColor: BRAND, marginTop: 3, marginBottom: 4, paddingTop: 4, fontWeight: 700, fontSize: 10.5 },
  words: { marginTop: 10 },
  section: { marginTop: 10 },
  sectionTitle: { fontWeight: 700, marginBottom: 2 },
  payRow: { flexDirection: "row", gap: 16, marginTop: 10, borderTopWidth: 1, borderColor: LINE, paddingTop: 8 },
  qr: { width: 74, height: 74 },
  sign: { alignItems: "flex-end", width: 150 },
  signImg: { height: 36, width: 110, objectFit: "contain", objectPosition: "right" },
  stamp: { position: "absolute", top: 300, left: 110, fontSize: 60, color: "#d7202a22", transform: "rotate(-25deg)", fontWeight: 700 },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

async function imageSrc(key: string | null | undefined) {
  if (!key) return null;
  const file = await getFile(key);
  return file ? `data:${mimeFor(key)};base64,${file.toString("base64")}` : null;
}

function PartyHeader({ logo, a }: { logo: string | null; a: InvoiceDocument["agency"] }) {
  return (
    <View style={{ flex: 1, paddingRight: 20 }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt */}
      {logo && <Image src={logo} style={s.logo} />}
      <Text style={s.agencyName}>{a.name}</Text>
      {a.address && <Text style={s.muted}>{a.address}</Text>}
      <Text style={s.muted}>{[a.phone, a.email, a.website].filter(Boolean).join(" · ")}</Text>
      {a.gstin && <Text style={s.muted}>GSTIN: {a.gstin}{a.state ? ` · State: ${a.state}` : ""}</Text>}
      {a.pan && <Text style={s.muted}>PAN: {a.pan}</Text>}
    </View>
  );
}

const Footer = ({ name }: { name: string }) => (
  <View style={s.footer} fixed>
    <Text>{name}</Text>
    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
  </View>
);

/** Same figures as the screen: both come from the same document. */
export async function renderInvoicePdf(doc: InvoiceDocument, opts: { logoKey?: string | null; signatureKey?: string | null; payAmount: DecimalLike }): Promise<Buffer> {
  const logo = await logoSrc(opts.logoKey);
  const signature = await imageSrc(opts.signatureKey);
  const open = doc.status === "ISSUED" && toDecimal(opts.payAmount).greaterThan(0);
  const qr = doc.bank.upiId && open ? await QRCode.toDataURL(upiLink({ upiId: doc.bank.upiId, payee: doc.agency.name, amount: opts.payAmount, note: doc.number }), { margin: 1, width: 220 }) : null;
  const bank = [doc.bank.bankName && `Bank: ${doc.bank.bankName}${doc.bank.branch ? `, ${doc.bank.branch}` : ""}`, doc.bank.accountName && `Account name: ${doc.bank.accountName}`, doc.bank.accountNumber && `Account no: ${doc.bank.accountNumber}`, doc.bank.ifsc && `IFSC: ${doc.bank.ifsc}`, doc.bank.upiId && `UPI: ${doc.bank.upiId}`].filter(Boolean) as string[];
  const stamp = doc.status === "CANCELLED" ? "CANCELLED" : doc.status === "DRAFT" ? "DRAFT" : null;
  return renderToBuffer(
    <Document title={`${doc.title} ${doc.number}`} author={doc.agency.name}>
      <Page size="A4" style={s.page}>
        {stamp && <Text style={s.stamp} fixed>{stamp}</Text>}
        <View style={s.header}>
          <PartyHeader logo={logo} a={doc.agency} />
          <View>
            <Text style={s.docTitle}>{doc.title}</Text>
            <Text style={[s.right, s.strong]}>{doc.number}</Text>
            <Text style={[s.right, s.muted]}>Date: {doc.invoiceDate}</Text>
            <Text style={[s.right, s.muted]}>Due: {doc.dueDate}</Text>
          </View>
        </View>
        <View style={s.band}>
          <View style={s.bandCol}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.strong}>{doc.client.name}</Text>
            {doc.client.contact && <Text>{doc.client.contact}</Text>}
            {doc.client.address && <Text style={s.muted}>{doc.client.address}</Text>}
          </View>
          <View style={s.bandCol}>
            <Text style={s.muted}>Place of supply: {doc.placeOfSupply}</Text>
            {doc.client.gstin && <Text style={s.muted}>GSTIN: {doc.client.gstin}</Text>}
            {doc.client.pan && <Text style={s.muted}>PAN: {doc.client.pan}</Text>}
            {doc.client.email && <Text style={s.muted}>{doc.client.email}</Text>}
            {doc.client.phone && <Text style={s.muted}>{doc.client.phone}</Text>}
          </View>
        </View>
        <View style={s.tableHead} fixed>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cSac}>SAC</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cRate}>Rate</Text>
          <Text style={s.cTaxable}>Taxable</Text>
          {doc.gst && <Text style={s.cGst}>GST</Text>}
          {doc.gst && <Text style={s.cTax}>Tax</Text>}
          <Text style={s.cTotal}>Amount</Text>
        </View>
        {doc.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <View style={s.cDesc}>
              <Text>{l.description}</Text>
              {l.discount && <Text style={[s.muted, { fontSize: 7 }]}>Discount {l.discount}</Text>}
            </View>
            <Text style={s.cSac}>{l.sac}</Text>
            <Text style={s.cQty}>{l.quantity}</Text>
            <Text style={s.cRate}>{l.rate}</Text>
            <Text style={s.cTaxable}>{l.taxable}</Text>
            {doc.gst && <Text style={s.cGst}>{l.gst}</Text>}
            {doc.gst && <Text style={s.cTax}>{l.tax}</Text>}
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
          {doc.settled.map((row) => (
            <View key={row.label} style={s.totalRow}>
              <Text style={s.muted}>{row.label}</Text>
              <Text>−{row.value}</Text>
            </View>
          ))}
          {doc.showBalance && (
            <View style={[s.totalRow, s.strong]}>
              <Text>Balance due</Text>
              <Text>{doc.balanceDue}</Text>
            </View>
          )}
        </View>
        <Text style={s.words}>Amount in words: {doc.amountInWords}</Text>
        {doc.taxNote && <Text style={[s.muted, { marginTop: 2 }]}>{doc.taxNote}</Text>}
        {doc.cancelReason && <Text style={[s.muted, { marginTop: 2 }]}>Cancelled: {doc.cancelReason}</Text>}
        <View style={s.payRow} wrap={false}>
          {qr && (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt
            <Image src={qr} style={s.qr} />
          )}
          <View style={{ flex: 1 }}>
            {bank.length > 0 && <Text style={s.sectionTitle}>Payment details</Text>}
            {bank.map((b) => <Text key={b} style={s.muted}>{b}</Text>)}
            {qr && <Text style={[s.muted, { marginTop: 2 }]}>Scan with any UPI app to pay.</Text>}
          </View>
          <View style={s.sign}>
            <Text style={s.muted}>For {doc.agency.name}</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt */}
            {signature ? <Image src={signature} style={s.signImg} /> : <View style={{ height: 36 }} />}
            <Text>Authorised signatory</Text>
          </View>
        </View>
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
        <Footer name={doc.agency.name} />
      </Page>
    </Document>,
  );
}

export type CreditNoteLine = { description: string; sacCode: string | null; gstRate: string; taxable: string; cgst: string; sgst: string; igst: string; total: string };

export async function renderCreditNotePdf(input: { doc: InvoiceDocument; logoKey?: string | null; number: string; dateKey: string; reason: string; lines: CreditNoteLine[]; taxable: DecimalLike; cgst: DecimalLike; sgst: DecimalLike; igst: DecimalLike; roundOff: DecimalLike; total: DecimalLike }): Promise<Buffer> {
  const { doc } = input;
  const logo = await logoSrc(input.logoKey);
  const rows = [
    { label: "Taxable value", value: formatINR(input.taxable) },
    ...(toDecimal(input.cgst).greaterThan(0) ? [{ label: "CGST", value: formatINR(input.cgst) }, { label: "SGST", value: formatINR(input.sgst) }] : []),
    ...(toDecimal(input.igst).greaterThan(0) ? [{ label: "IGST", value: formatINR(input.igst) }] : []),
    ...(toDecimal(input.roundOff).isZero() ? [] : [{ label: "Round-off", value: formatINR(input.roundOff) }]),
  ];
  return renderToBuffer(
    <Document title={`Credit note ${input.number}`} author={doc.agency.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <PartyHeader logo={logo} a={doc.agency} />
          <View>
            <Text style={s.docTitle}>CREDIT NOTE</Text>
            <Text style={[s.right, s.strong]}>{input.number}</Text>
            <Text style={[s.right, s.muted]}>Date: {formatDateKey(input.dateKey)}</Text>
            <Text style={[s.right, s.muted]}>Against invoice: {doc.number} ({doc.invoiceDate})</Text>
          </View>
        </View>
        <View style={s.band}>
          <View style={s.bandCol}>
            <Text style={s.label}>Issued to</Text>
            <Text style={s.strong}>{doc.client.name}</Text>
            {doc.client.address && <Text style={s.muted}>{doc.client.address}</Text>}
          </View>
          <View style={s.bandCol}>
            <Text style={s.muted}>Place of supply: {doc.placeOfSupply}</Text>
            {doc.client.gstin && <Text style={s.muted}>GSTIN: {doc.client.gstin}</Text>}
          </View>
        </View>
        <Text style={{ marginBottom: 8 }}>Reason: {input.reason}</Text>
        <View style={s.tableHead}>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cSac}>SAC</Text>
          <Text style={s.cTaxable}>Taxable</Text>
          <Text style={s.cGst}>GST</Text>
          <Text style={s.cTotal}>Amount</Text>
        </View>
        {input.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={s.cSac}>{l.sacCode ?? ""}</Text>
            <Text style={s.cTaxable}>{formatINR(l.taxable)}</Text>
            <Text style={s.cGst}>{doc.gst ? `${l.gstRate}%` : ""}</Text>
            <Text style={s.cTotal}>{formatINR(l.total)}</Text>
          </View>
        ))}
        <View style={s.totals}>
          {rows.map((row) => (
            <View key={row.label} style={s.totalRow}>
              <Text style={s.muted}>{row.label}</Text>
              <Text>{row.value}</Text>
            </View>
          ))}
          <View style={s.grand}>
            <Text>Credit total</Text>
            <Text>{formatINR(input.total)}</Text>
          </View>
        </View>
        <Text style={s.words}>Amount in words: {amountInWords(input.total)}</Text>
        <Footer name={doc.agency.name} />
      </Page>
    </Document>,
  );
}

export async function renderStatementPdf(input: { agency: InvoiceDocument["agency"]; logoKey?: string | null; client: { name: string; address?: string | null; gstin?: string | null }; from: string; to: string; opening: DecimalLike; closing: DecimalLike; totalDebit: DecimalLike; totalCredit: DecimalLike; rows: { dateKey: string; reference: string; description: string; debit: DecimalLike; credit: DecimalLike; balance: DecimalLike }[] }): Promise<Buffer> {
  const logo = await logoSrc(input.logoKey);
  const bal = (v: DecimalLike) => (toDecimal(v).isNegative() ? `${formatINR(toDecimal(v).abs())} Cr` : formatINR(v));
  const show = (v: DecimalLike) => (toDecimal(v).isZero() ? "" : formatINR(v));
  return renderToBuffer(
    <Document title={`Statement ${input.client.name}`} author={input.agency.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <PartyHeader logo={logo} a={input.agency} />
          <View>
            <Text style={s.docTitle}>STATEMENT OF ACCOUNT</Text>
            <Text style={[s.right, s.muted]}>{formatDateKey(input.from)} to {formatDateKey(input.to)}</Text>
          </View>
        </View>
        <View style={s.band}>
          <View style={s.bandCol}>
            <Text style={s.label}>Client</Text>
            <Text style={s.strong}>{input.client.name}</Text>
            {input.client.address && <Text style={s.muted}>{input.client.address}</Text>}
            {input.client.gstin && <Text style={s.muted}>GSTIN: {input.client.gstin}</Text>}
          </View>
          <View style={s.bandCol}>
            <Text style={s.right}>Opening balance: {bal(input.opening)}</Text>
            <Text style={[s.right, s.strong]}>Closing balance: {bal(input.closing)}</Text>
          </View>
        </View>
        <View style={s.tableHead} fixed>
          <Text style={{ width: 56 }}>Date</Text>
          <Text style={{ width: 96 }}>Reference</Text>
          <Text style={s.cDesc}>Details</Text>
          <Text style={s.cTaxable}>Debit</Text>
          <Text style={s.cTaxable}>Credit</Text>
          <Text style={s.cTotal}>Balance</Text>
        </View>
        {input.rows.map((r, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ width: 56 }}>{formatDateKey(r.dateKey)}</Text>
            <Text style={{ width: 96 }}>{r.reference}</Text>
            <Text style={s.cDesc}>{r.description}</Text>
            <Text style={s.cTaxable}>{show(r.debit)}</Text>
            <Text style={s.cTaxable}>{show(r.credit)}</Text>
            <Text style={s.cTotal}>{bal(r.balance)}</Text>
          </View>
        ))}
        <View style={[s.row, s.strong]} wrap={false}>
          <Text style={{ width: 152 }} />
          <Text style={s.cDesc}>Totals</Text>
          <Text style={s.cTaxable}>{formatINR(input.totalDebit)}</Text>
          <Text style={s.cTaxable}>{formatINR(input.totalCredit)}</Text>
          <Text style={s.cTotal}>{bal(input.closing)}</Text>
        </View>
        <Text style={[s.muted, { marginTop: 6 }]}>“Cr” means the client has paid in advance.</Text>
        <Footer name={input.agency.name} />
      </Page>
    </Document>,
  );
}
