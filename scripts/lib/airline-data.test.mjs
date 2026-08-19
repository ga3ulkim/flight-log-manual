import { describe, expect, it } from 'vitest';
import {
  AIRLINE_CESSATION_CUTOFF_YEAR,
  WIKIDATA_AIRLINE_ALIAS_QUERY,
  WIKIDATA_AIRLINE_CORE_QUERY,
  WIKIDATA_AIRLINE_QUERY,
  buildAirlineIndex,
  formatGeneratedAirlineModule,
  isEligibleByDissolution,
  validateAirlineSearchIndex,
} from './airline-data.mjs';

function value(text, language) {
  return language
    ? { type: 'literal', value: text, 'xml:lang': language }
    : { type: 'literal', value: text };
}

function airlineBinding(qid, overrides = {}) {
  return {
    airline: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
    labelEn: value(`Airline ${qid}`, 'en'),
    iataCodes: value('ZZ'),
    icaoCodes: value('ZZZ'),
    countries: value('Test%20Country'),
    aliases: value('Test%20Airways'),
    ...overrides,
  };
}

function sparqlDocument(bindings) {
  return { head: { vars: ['airline'] }, results: { bindings } };
}

describe('Wikidata airline generation', () => {
  it('queries explicit non-deprecated IATA, ICAO, and cessation statements', () => {
    expect(WIKIDATA_AIRLINE_CORE_QUERY).toContain('p:P229');
    expect(WIKIDATA_AIRLINE_CORE_QUERY).toContain('p:P230');
    expect(WIKIDATA_AIRLINE_CORE_QUERY.match(/wikibase:DeprecatedRank/g))
      .toHaveLength(3);
    expect(WIKIDATA_AIRLINE_CORE_QUERY).toContain('psv:P576');
    expect(WIKIDATA_AIRLINE_CORE_QUERY).not.toContain('skos:altLabel');
    expect(WIKIDATA_AIRLINE_ALIAS_QUERY).toContain('skos:altLabel');
    expect(WIKIDATA_AIRLINE_QUERY).toContain('# --- companion query ---');
  });

  it('implements the conservative post-2000 eligibility boundary', () => {
    expect(AIRLINE_CESSATION_CUTOFF_YEAR).toBe(2000);
    expect(isEligibleByDissolution([])).toBe(true);
    expect(isEligibleByDissolution(['1999-01-01T00:00:00Z~9'])).toBe(false);
    expect(isEligibleByDissolution(['2000-01-01T00:00:00Z~9'])).toBe(true);
    expect(isEligibleByDissolution(['2017-10-27T00:00:00Z~11'])).toBe(true);
    expect(isEligibleByDissolution(['1991-12-04T00:00:00Z~8'])).toBe(true);
    expect(isEligibleByDissolution(['not-a-date~11'])).toBe(true);
    expect(isEligibleByDissolution([
      '1991-12-04T00:00:00Z~11',
      '2005-01-01T00:00:00Z~9',
    ])).toBe(true);
  });

  it('prefers English and uses only a Latin multilingual fallback', () => {
    const result = buildAirlineIndex(sparqlDocument([
      airlineBinding('Q1', {
        labelEn: value('English Name', 'en'),
        labelMul: value('Invariant Name', 'mul'),
      }),
      airlineBinding('Q2', {
        labelEn: undefined,
        labelMul: value('Korean Air', 'mul'),
        iataCodes: value('KE'),
        icaoCodes: value('KAL'),
      }),
      airlineBinding('Q3', {
        labelEn: undefined,
        labelMul: value('한글만', 'mul'),
      }),
    ]));

    expect(result.searchEntries.map(([name]) => name)).toEqual([
      'English Name',
      'Korean Air',
    ]);
    expect(result.stats.missingCanonicalName).toBe(1);
  });

  it('includes post-2000 and uncertain history but excludes reliable pre-2000', () => {
    const result = buildAirlineIndex(sparqlDocument([
      airlineBinding('Q10', {
        labelEn: value('Air Berlin', 'en'),
        iataCodes: value('AB'),
        icaoCodes: value('BER'),
        dissolvedDates: value('2017-10-27T00%3A00%3A00Z~11'),
      }),
      airlineBinding('Q11', {
        labelEn: value('Pan Am', 'en'),
        iataCodes: value('PA'),
        icaoCodes: value('PAA'),
        dissolvedDates: value('1991-12-04T00%3A00%3A00Z~11'),
      }),
      airlineBinding('Q12', {
        labelEn: value('Uncertain Historic Air', 'en'),
        dissolvedDates: value('1950-01-01T00%3A00%3A00Z~8'),
      }),
    ]));

    expect(result.searchEntries.map(([name]) => name)).toEqual([
      'Air Berlin',
      'Uncertain Historic Air',
    ]);
    expect(result.stats.ceasedBeforeCutoff).toBe(1);
  });

  it('sorts and deduplicates multi-value source data deterministically', () => {
    const result = buildAirlineIndex(sparqlDocument([
      airlineBinding('Q20', {
        labelEn: value('Example Air', 'en'),
        iataCodes: value('Z9|A1|A1|bad'),
        icaoCodes: value('ZZZ|AAA|A1A'),
        countries: value('United%20States|Canada|Canada'),
        aliases: value('Example%20Air|Z9|Example%20Airlines|Air%7CPipe'),
      }),
    ]));

    expect(result.searchEntries).toEqual([[
      'Example Air',
      ['A1', 'Z9'],
      ['AAA', 'ZZZ'],
      'Canada / United States',
      ['Air|Pipe', 'Example Airlines'],
    ]]);
    expect(result.stats).toMatchObject({ invalidIata: 1, invalidIcao: 1 });
  });

  it('merges duplicate entity rows and validates stable output ordering', () => {
    const bindings = [
      airlineBinding('Q30', {
        labelEn: value('Zulu Air', 'en'),
        aliases: value('Zulu'),
      }),
      airlineBinding('Q30', {
        labelEn: value('Zulu Air', 'en'),
        aliases: value('Zed'),
      }),
      airlineBinding('Q31', { labelEn: value('Alpha Air', 'en') }),
    ];
    const result = buildAirlineIndex(sparqlDocument(bindings));
    const shuffled = buildAirlineIndex(sparqlDocument([...bindings].reverse()));

    expect(result.stats.sourceRows).toBe(3);
    expect(result.stats.sourceEntities).toBe(2);
    expect(result.searchEntries.map(([name]) => name)).toEqual([
      'Alpha Air',
      'Zulu Air',
    ]);
    expect(result.searchEntries[1][4]).toEqual(['Zed', 'Zulu']);
    expect(JSON.stringify(shuffled.searchEntries)).toBe(
      JSON.stringify(result.searchEntries),
    );
    expect(formatGeneratedAirlineModule(shuffled.searchEntries)).toBe(
      formatGeneratedAirlineModule(result.searchEntries),
    );
    expect(validateAirlineSearchIndex(result.searchEntries)).toBe(2);
    expect(() => validateAirlineSearchIndex([...result.searchEntries].reverse()))
      .toThrow(/not sorted/);
    expect(() => validateAirlineSearchIndex([
      ['Bad Alias Air', [], [], '', [' leading alias']],
    ])).toThrow(/aliases/);
    expect(() => validateAirlineSearchIndex([
      ['Control Alias Air', [], [], '', ['line\nbreak']],
    ])).toThrow(/aliases/);
  });

  it('rejects malformed upstream documents and entity identifiers', () => {
    expect(() => buildAirlineIndex('{}')).toThrow(/SPARQL JSON/);
    expect(() => buildAirlineIndex(sparqlDocument([
      { airline: { type: 'uri', value: 'https://example.com/Q1' } },
    ]))).toThrow(/entity URI/);
  });

  it('formats a compact typed browser module with stable provenance', () => {
    const generated = formatGeneratedAirlineModule(
      [['Korean Air', ['KE'], ['KAL'], 'South Korea', ['Korean Air Lines']]],
      { querySha256: 'query-digest', dataSha256: 'data-digest' },
    );

    expect(generated).toContain('GENERATED_AIRLINE_COUNT = 1');
    expect(generated).toContain('WIKIDATA_AIRLINE_QUERY_SHA256 = "query-digest"');
    expect(generated).toContain('WIKIDATA_AIRLINE_DATA_SHA256 = "data-digest"');
    expect(generated).toContain(
      '["Korean Air",["KE"],["KAL"],"South Korea",["Korean Air Lines"]]',
    );
    expect(generated).toContain('Missing/coarse/conflicting dates stay included.');
    expect(generated).not.toContain('Q213147');
  });
});
