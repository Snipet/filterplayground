/** Small dense linear-algebra helpers (row-major number[][]). */
export type Matrix = number[][];

export const zeros = (r: number, cc: number): Matrix =>
	Array.from({ length: r }, () => new Array<number>(cc).fill(0));

export function eye(n: number): Matrix {
	const m = zeros(n, n);
	for (let i = 0; i < n; i++) m[i][i] = 1;
	return m;
}

export function matmul(a: Matrix, b: Matrix): Matrix {
	const n = a.length;
	const m = b[0]?.length ?? 0;
	const k = b.length;
	const out = zeros(n, m);
	for (let i = 0; i < n; i++)
		for (let l = 0; l < k; l++) {
			const v = a[i][l];
			if (v === 0) continue;
			for (let j = 0; j < m; j++) out[i][j] += v * b[l][j];
		}
	return out;
}

export function matvec(a: Matrix, x: readonly number[]): number[] {
	return a.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

export const matadd = (a: Matrix, b: Matrix): Matrix => a.map((r, i) => r.map((v, j) => v + b[i][j]));
export const matsub = (a: Matrix, b: Matrix): Matrix => a.map((r, i) => r.map((v, j) => v - b[i][j]));
export const matscale = (a: Matrix, s: number): Matrix => a.map((r) => r.map((v) => v * s));

export function norm1(a: Matrix): number {
	let best = 0;
	for (let j = 0; j < (a[0]?.length ?? 0); j++) {
		let s = 0;
		for (let i = 0; i < a.length; i++) s += Math.abs(a[i][j]);
		best = Math.max(best, s);
	}
	return best;
}

/** Solve A·X = B for X (B may have several columns) with partial pivoting. */
export function solve(aIn: Matrix, bIn: Matrix): Matrix {
	const n = aIn.length;
	const a = aIn.map((r) => [...r]);
	const b = bIn.map((r) => [...r]);
	const m = b[0].length;
	for (let col = 0; col < n; col++) {
		let piv = col;
		for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
		if (piv !== col) {
			[a[col], a[piv]] = [a[piv], a[col]];
			[b[col], b[piv]] = [b[piv], b[col]];
		}
		const d = a[col][col];
		if (d === 0) throw new Error('Singular matrix');
		for (let r = col + 1; r < n; r++) {
			const f = a[r][col] / d;
			if (f === 0) continue;
			for (let cc = col; cc < n; cc++) a[r][cc] -= f * a[col][cc];
			for (let cc = 0; cc < m; cc++) b[r][cc] -= f * b[col][cc];
		}
	}
	const x = zeros(n, m);
	for (let r = n - 1; r >= 0; r--) {
		for (let cc = 0; cc < m; cc++) {
			let s = b[r][cc];
			for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k][cc];
			x[r][cc] = s / a[r][r];
		}
	}
	return x;
}

/** Solve a square linear system for a single right-hand side vector. */
export function solveVec(a: Matrix, b: readonly number[]): number[] {
	return solve(
		a,
		b.map((v) => [v])
	).map((r) => r[0]);
}

/** Matrix exponential via scaling & squaring with a degree-6 Padé approximant. */
export function expm(a: Matrix): Matrix {
	const n = a.length;
	const nrm = norm1(a);
	let s = 0;
	if (nrm > 0.5) s = Math.max(0, Math.ceil(Math.log2(nrm / 0.5)));
	const as = matscale(a, Math.pow(2, -s));
	// Padé(6,6) coefficients
	const cs = [1, 1 / 2, 5 / 44, 1 / 66, 1 / 792, 1 / 15840, 1 / 665280];
	let X = eye(n);
	let N = eye(n);
	let D = eye(n);
	let sign = 1;
	for (let k = 1; k <= 6; k++) {
		X = matmul(as, X);
		const cX = matscale(X, cs[k]);
		N = matadd(N, cX);
		sign = -sign;
		D = sign > 0 ? matadd(D, cX) : matsub(D, cX);
	}
	let E = solve(D, N);
	for (let k = 0; k < s; k++) E = matmul(E, E);
	return E;
}
