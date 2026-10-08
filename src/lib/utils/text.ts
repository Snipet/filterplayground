/**
 * Map Unicode hyphens and dashes (U+2010–U+2015) and the minus sign (U+2212) to an ASCII
 * hyphen, so a typed 'Sallen-Key' or '-3 dB' finds 'Sallen–Key' and '−3 dB'. Every mapped
 * character is a single UTF-16 unit, so string length and indices are unchanged.
 */
export const foldDashes = (s: string): string => s.replace(/[‐-―−]/g, '-');
