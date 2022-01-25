import { safe as b64 } from '@tradle/urlsafe-base64'
import fs from 'fs'
import { resolve } from 'path'
import debug from 'debug'

const { readFile } = fs.promises
const log = debug('tradle:kycdeepface:index')

export type Point = [
  number,
  number
]

export interface Embedding {
  bounds: {
    topLeft: Point,
    bottomRight: Point
  }
  landmarks: {
    outline: Point[]
    left_brows: Point[]
    right_brows: Point[]
    nose_back: Point[]
    nostrils: Point[]
    left_eye: Point[]
    right_eye: Point[]
    mouth: Point[]
  },
  angles: {
    pitch: number
    yaw: number
    roll: number
  }
  embedding: string
}

export interface Embeddings {
  faces: Embedding[]
  timings: { [type: string]: number }
}

export interface Match {
  similarity: number
  timings: { [type: string]: number }
}

export interface InputBytes {
  image_bytes: Buffer
}

export interface InputFile {
  image_file: string
}

export interface InputURL {
  image_url: string
}

export interface InputS3 {
  image_s3: {
    bucket: string
    key: string
    version?: string
  }
}

export interface InputBase64 {
  image_urlsafe_b64: string
}

export type Input = InputS3 | InputURL | InputBytes | InputFile | InputBase64

export function isInputFile (input: Input): input is InputFile {
  return 'image_file' in input
}

export function isInputBytes (input: Input): input is InputBytes {
  return 'image_bytes' in input
}

async function normalizeInput (input: Input): Promise<InputS3 | InputURL | InputBase64> {
  if (isInputFile(input)) {
    const pth = resolve(input.image_file)
    try {
      return normalizeInput({
        image_bytes: await readFile(pth)
      })
    } catch (err) {
      throw Object.assign(new Error(`Error while loading file ${pth}: ${err.message}`), err)
    }
  }
  if (isInputBytes(input)) {
    return {
      image_urlsafe_b64: b64.encode(input.image_bytes)
    }
  }
  return input
}

export interface Exec {
  description: string,
  run: (input: any) => Promise<any>
}

async function exec<T>(name: string, execFn: Exec, input: any): Promise<T> {
  log(name, execFn.description, input)
  input = { [name]: input }
  try {
    return await execFn.run(input)
  } catch (err) {
    log(`${name}:retry`, err)
    return await execFn.run(input)
  }
}

export async function face_embeddings (execFn: Exec, input: Input): Promise<Embeddings> {
  return await exec<Embeddings>('face_embeddings', execFn, await normalizeInput(input))
}

export async function face_match (execFn: Exec, embedding_a: string, embedding_b: string): Promise<Match> {
  return await exec<Match>('face_match', execFn, { embedding_a, embedding_b })
}
