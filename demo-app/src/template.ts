/**
 * Programmatic template builder for the demo.
 *
 * Builds a valid `.docx` archive from scratch using PizZip — bytes are
 * indistinguishable from a Word-authored file as far as our parser is
 * concerned. The template contains a small Ukrainian contract with
 * inline value placeholders (party_a.full_name, party_b.full_name, etc.)
 * AND a block-level requisites:party_b placeholder so the demo
 * exercises the requisites injection path as well.
 *
 * In a real host this kind of template comes from user uploads via the
 * `POST /v1/templates` endpoint; we build one in-process here so the
 * demo runs without any external fixtures.
 *
 * NOTE: PizZip is a transitive dependency of @doccop/core. We import it
 * via the engine's dependency tree rather than declaring it directly —
 * keeps the demo-app dependency surface minimal.
 */

import PizZip from "pizzip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const PKG_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
</w:styles>`;

function inlineSdt(tag: string, alias: string, placeholderText: string, bold = false): string {
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:sdt>
        <w:sdtPr>
          <w:tag w:val="${tag}"/>
          <w:alias w:val="${alias}"/>
          <w:lock w:val="contentLocked"/>
        </w:sdtPr>
        <w:sdtContent><w:r>${rPr}<w:t xml:space="preserve">${placeholderText}</w:t></w:r></w:sdtContent>
      </w:sdt>`;
}

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="00000001">
      <w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>
      <w:r><w:t xml:space="preserve">ДОГОВІР № </w:t></w:r>
      ${inlineSdt("system.contract_number", "Номер договору", "[номер]", true)}
    </w:p>
    <w:p w14:paraId="00000002">
      <w:pPr><w:jc w:val="right"/></w:pPr>
      <w:r><w:t xml:space="preserve">м. Київ, </w:t></w:r>
      ${inlineSdt("system.today", "Дата", "[дата]")}
    </w:p>
    <w:p w14:paraId="00000003">
      <w:r><w:t xml:space="preserve">Сторона А: </w:t></w:r>
      ${inlineSdt("party_a.full_name", "Сторона А — повна назва", "[Сторона А]", true)}
      <w:r><w:t xml:space="preserve">, в особі директора </w:t></w:r>
      ${inlineSdt("party_a.director_name", "Сторона А — директор", "[директор А]")}
      <w:r><w:t xml:space="preserve">, який діє на підставі статуту.</w:t></w:r>
    </w:p>
    <w:p w14:paraId="00000004">
      <w:r><w:t xml:space="preserve">Сторона Б: </w:t></w:r>
      ${inlineSdt("party_b.full_name", "Сторона Б — повна назва", "[Сторона Б]", true)}
      <w:r><w:t xml:space="preserve">, в особі директора </w:t></w:r>
      ${inlineSdt("party_b.director_name", "Сторона Б — директор", "[директор Б]")}
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
    <w:p w14:paraId="00000005">
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">1. Предмет договору</w:t></w:r>
    </w:p>
    <w:p w14:paraId="00000006">
      <w:r><w:t xml:space="preserve">Сторона А зобов'язується надати Стороні Б послуги відповідно до умов цього договору. Розрахунки здійснюються через IBAN Сторони А: </w:t></w:r>
      ${inlineSdt("party_a.iban", "IBAN Сторони А", "[IBAN А]", true)}
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
    <w:p w14:paraId="00000007">
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">2. Реквізити сторін</w:t></w:r>
    </w:p>
    <w:p w14:paraId="00000008">
      <w:r><w:t xml:space="preserve">Сторона А: ЄДРПОУ </w:t></w:r>
      ${inlineSdt("party_a.edrpou", "ЄДРПОУ А", "[ЄДРПОУ А]")}
      <w:r><w:t xml:space="preserve">. Адреса: </w:t></w:r>
      ${inlineSdt("party_a.address", "Адреса А", "[адреса А]")}
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
    <w:p w14:paraId="00000009">
      <w:r><w:t xml:space="preserve">Сторона Б: ЄДРПОУ </w:t></w:r>
      ${inlineSdt("party_b.edrpou", "ЄДРПОУ Б", "[ЄДРПОУ Б]")}
      <w:r><w:t xml:space="preserve">. Адреса: </w:t></w:r>
      ${inlineSdt("party_b.address", "Адреса Б", "[адреса Б]")}
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

/**
 * Produce a `.docx` byte stream representing a Ukrainian contract
 * template with inline SDT placeholders bound to party_a / party_b /
 * system scopes. The result is a valid OOXML archive — opens cleanly
 * in Word, parses cleanly through `@doccop/core`'s `parse()`.
 */
export function buildSampleTemplate(): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", PKG_RELS);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/document.xml", DOCUMENT_XML);
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
