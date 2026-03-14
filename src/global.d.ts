interface JsonWebKey {
	alg?: string
	crv?: string
	d?: string
	dp?: string
	dq?: string
	e?: string
	ext?: boolean
	k?: string
	key_ops?: string[]
	kty?: string
	n?: string
	oth?: RsaOtherPrimesInfo[]
	p?: string
	q?: string
	qi?: string
	use?: string
	x?: string
	y?: string
	[key: string]: unknown
}
