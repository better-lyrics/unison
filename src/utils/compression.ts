export async function compress(data: string): Promise<string> {
	const encoder = new TextEncoder()
	const stream = new CompressionStream("gzip")

	const writer = stream.writable.getWriter()
	writer.write(encoder.encode(data))
	writer.close()

	const compressedChunks: Uint8Array[] = []
	const reader = stream.readable.getReader()

	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		compressedChunks.push(value)
	}

	const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0)
	const compressed = new Uint8Array(totalLength)
	let offset = 0
	for (const chunk of compressedChunks) {
		compressed.set(chunk, offset)
		offset += chunk.length
	}

	return btoa(String.fromCharCode(...compressed))
}

export async function decompress(base64Data: string): Promise<string> {
	const binaryString = atob(base64Data)
	const bytes = new Uint8Array(binaryString.length)
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i)
	}

	const stream = new DecompressionStream("gzip")

	const writer = stream.writable.getWriter()
	writer.write(bytes)
	writer.close()

	const decompressedChunks: Uint8Array[] = []
	const reader = stream.readable.getReader()

	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		decompressedChunks.push(value)
	}

	const totalLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0)
	const decompressed = new Uint8Array(totalLength)
	let offset = 0
	for (const chunk of decompressedChunks) {
		decompressed.set(chunk, offset)
		offset += chunk.length
	}

	return new TextDecoder().decode(decompressed)
}

export function isCompressed(data: string): boolean {
	if (data.length < 10) return false
	try {
		const decoded = atob(data.slice(0, 10))
		return decoded.charCodeAt(0) === 0x1f && decoded.charCodeAt(1) === 0x8b
	} catch {
		return false
	}
}
