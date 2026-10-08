/** Assemble every structure (processor, diagram, code, operation count) for one filter. */
import type { SOS } from '$lib/dsp/types';
import { codeCascade, codeDf1, codeDf2, codeFir, codeFirLattice, codeFirTransposed, codeLatticeLadder, codeParallel, codeTdf2 } from './ccode';
import {
	diagramCascade,
	diagramDf1,
	diagramDf2,
	diagramFir,
	diagramFirLattice,
	diagramFirTransposed,
	diagramLatticeLadder,
	diagramParallel,
	diagramTdf2,
	type Diagram
} from './diagram';
import {
	cascade,
	df1,
	df2,
	firDirect,
	firLattice,
	firLatticeProc,
	firTransposed,
	latticeLadder,
	latticeLadderProc,
	parallel,
	parallelForm,
	sectionOrder,
	STRUCTURE_IDS,
	STRUCTURE_NAMES,
	sub,
	tdf2,
	type Ops,
	type Processor,
	type StructureId
} from './realize';

export interface StructureInfo {
	id: StructureId;
	name: string;
	applicable: boolean;
	/** Why the structure is not available for this filter. */
	reason?: string;
	ops?: Ops;
	stateLabels: string[];
	make?: () => Processor;
	diagram?: () => Diagram;
	code?: string;
	/** Extra facts, e.g. reflection coefficients. */
	notes: string[];
	/** Lattice only: all |k| < 1? */
	latticeStable?: boolean;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function buildStructures(b: number[], a: number[], sos: SOS): StructureInfo[] {
	const isFir = a.length === 1;
	const M = b.length - 1;
	const N = a.length - 1;
	const K = Math.max(M, N);
	const out: StructureInfo[] = [];
	const firOnly = (id: StructureId): StructureInfo => ({
		id,
		name: STRUCTURE_NAMES[id],
		applicable: false,
		reason: 'Only for FIR filters (no feedback). For an IIR filter use the direct forms.',
		stateLabels: [],
		notes: []
	});

	for (const id of STRUCTURE_IDS) {
		const name = STRUCTURE_NAMES[id];
		try {
			switch (id) {
				case 'df1':
				case 'df2':
				case 'tdf2': {
					if (isFir) {
						out.push({
							id,
							name,
							applicable: false,
							reason: `With a = [1] there is no feedback: ${id === 'tdf2' ? 'TDF II reduces to the FIR transposed form' : 'DF I and DF II reduce to the FIR direct form'}.`,
							stateLabels: [],
							notes: []
						});
						break;
					}
					if (id === 'df1')
						out.push({
							id,
							name,
							applicable: true,
							ops: { mul: M + 1 + N, add: M + N, delay: M + N },
							stateLabels: [...range(M).map((k) => `x[n−${k + 1}]`), ...range(N).map((k) => `y[n−${k + 1}]`)],
							make: () => df1(b, a),
							diagram: () => diagramDf1(b, a),
							code: codeDf1(b, a),
							notes: ['Separate delay lines for past inputs and past outputs; a single accumulator sums all products, so intermediate overflow is harmless in two’s-complement arithmetic.']
						});
					else if (id === 'df2')
						out.push({
							id,
							name,
							applicable: true,
							ops: { mul: M + 1 + N, add: M + N, delay: K },
							stateLabels: range(K).map((k) => `w[n−${k + 1}]`),
							make: () => df2(b, a),
							diagram: () => diagramDf2(b, a),
							code: codeDf2(b, a),
							notes: ['Poles first, then zeros: the internal signal w[n] can be much larger than x or y (its gain is 1/A(z)), which is a scaling problem in fixed point.']
						});
					else
						out.push({
							id,
							name,
							applicable: true,
							ops: { mul: M + 1 + N, add: M + N, delay: K },
							stateLabels: range(K).map((k) => `s${sub(k + 1)}`),
							make: () => tdf2(b, a),
							diagram: () => diagramTdf2(b, a),
							code: codeTdf2(b, a),
							notes: ['The transpose of DF II: same delays and multipliers, but zeros come first. Preferred in floating point (used by scipy.signal.sosfilt).']
						});
					break;
				}
				case 'cascade': {
					const orders = sos.map((r) => sectionOrder(r.map((v) => v / (r[3] || 1))));
					const ops = orders.reduce(
						(acc, o) => ({ mul: acc.mul + (o === 2 ? 5 : o === 1 ? 3 : 1), add: acc.add + (o === 2 ? 4 : o === 1 ? 2 : 0), delay: acc.delay + o }),
						{ mul: 0, add: 0, delay: 0 }
					);
					out.push({
						id,
						name,
						applicable: true,
						ops,
						stateLabels: orders.flatMap((o, i) => range(o).map((k) => `${i + 1}:s${sub(k + 1)}`)),
						make: () => cascade(sos),
						diagram: () => diagramCascade(sos),
						code: codeCascade(sos),
						notes: [`${sos.length} section${sos.length > 1 ? 's' : ''}, each a transposed direct form II biquad. Each section only places two poles and two zeros, so coefficient errors stay local.`]
					});
					break;
				}
				case 'parallel': {
					if (isFir) {
						out.push({ id, name, applicable: false, reason: 'An FIR filter has no poles to expand around: its parallel form is just the taps.', stateLabels: [], notes: [] });
						break;
					}
					const form = parallelForm(b, a);
					let mul = 0;
					let add = 0;
					let delay = 0;
					for (const s of form.sections) {
						const o = s.a.length - 1;
						mul += o === 2 ? 4 : 2;
						add += o === 2 ? 3 : 1;
						delay += o;
					}
					const D = form.direct.length;
					if (D) {
						mul += D;
						add += D - 1;
						delay += D - 1;
					}
					add += form.sections.length + (D ? 1 : 0) - 1;
					out.push({
						id,
						name,
						applicable: true,
						ops: { mul, add, delay },
						stateLabels: [
							...form.sections.flatMap((s, i) => range(s.a.length - 1).map((k) => `${i + 1}:s${sub(k + 1)}`)),
							...range(Math.max(0, D - 1)).map((k) => `d:s${sub(k + 1)}`)
						],
						make: () => parallel(form),
						diagram: () => diagramParallel(form),
						code: codeParallel(form),
						notes: ['Partial-fraction expansion: conjugate pole pairs are combined into real second-order sections. The sections run independently (good for parallel hardware) and their errors add rather than multiply.']
					});
					break;
				}
				case 'lattice': {
					if (isFir) {
						const fl = firLattice(b);
						out.push({
							id,
							name: 'Lattice (FIR)',
							applicable: true,
							ops: { mul: 2 * M + (fl.h0 !== 1 ? 1 : 0), add: 2 * M, delay: M },
							stateLabels: range(M).map((m) => `g${sub(m)}[n−1]`),
							make: () => firLatticeProc(fl),
							diagram: () => diagramFirLattice(fl),
							code: codeFirLattice(fl),
							notes: [`Reflection coefficients k = [${fl.k.map((v) => v.toPrecision(4)).join(', ')}], gain h₀ = ${fl.h0.toPrecision(4)}.`, fl.k.every((v) => Math.abs(v) < 1) ? 'All |k| < 1: the FIR is minimum phase.' : 'Some |k| > 1: the FIR is not minimum phase (fine for an FIR — it is always stable).'],
							latticeStable: fl.k.every((v) => Math.abs(v) < 1)
						});
					} else {
						const ll = latticeLadder(b, a);
						const Nl = ll.k.length;
						const stable = ll.k.every((v) => Math.abs(v) < 1);
						out.push({
							id,
							name: 'Lattice–ladder (IIR)',
							applicable: true,
							ops: { mul: 3 * Nl + 1, add: 3 * Nl, delay: Nl },
							stateLabels: range(Nl).map((m) => `g${sub(m)}[n−1]`),
							make: () => latticeLadderProc(ll),
							diagram: () => diagramLatticeLadder(ll),
							code: codeLatticeLadder(ll),
							notes: [
								`Reflection coefficients k = [${ll.k.map((v) => v.toPrecision(4)).join(', ')}]; ladder taps ν = [${ll.v.map((v) => v.toPrecision(4)).join(', ')}].`,
								stable ? 'All |kₘ| < 1 ⇒ the filter is stable — the lattice gives a stability test for free.' : 'Some |kₘ| ≥ 1 ⇒ the filter is unstable.'
							],
							latticeStable: stable
						});
					}
					break;
				}
				case 'fir':
				case 'firt': {
					if (!isFir) {
						out.push(firOnly(id));
						break;
					}
					out.push({
						id,
						name,
						applicable: true,
						ops: { mul: M + 1, add: M, delay: M },
						stateLabels: id === 'fir' ? range(M).map((k) => `x[n−${k + 1}]`) : range(M).map((k) => `s${sub(k + 1)}`),
						make: () => (id === 'fir' ? firDirect(b) : firTransposed(b)),
						diagram: () => (id === 'fir' ? diagramFir(b) : diagramFirTransposed(b)),
						code: id === 'fir' ? codeFir(b) : codeFirTransposed(b),
						notes:
							id === 'fir'
								? ['A tapped delay line: the input is delayed and each delayed copy is weighted and summed. One long adder chain per output.']
								: ['The transpose of the direct form: each input sample is multiplied by all taps at once and partial sums travel through the delays. Short critical path — popular in hardware.']
					});
					break;
				}
			}
		} catch (e) {
			out.push({ id, name, applicable: false, reason: e instanceof Error ? e.message : String(e), stateLabels: [], notes: [] });
		}
	}
	return out;
}
