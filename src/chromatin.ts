import { ChromatinScene, ChromatinChunk, ChromatinPart, ChromatinModel, ChromatinSceneConfig } from "./chromatin-types";
import { ChromatinBasicRenderer } from "./renderer/ChromatinBasicRenderer";
import { coordinateToBin } from "./utils";

/**
 * Utility function to add a chunk to scene
 */
export function addChunkToScene(
  scene: ChromatinScene,
  chunk: ChromatinChunk,
): ChromatinScene {
  scene = {
    ...scene,
    chunks: [...scene.chunks, chunk],
  };
  return scene;
}

/**
 * Utility function to add a model to scene
 */
export function addModelToScene(scene: ChromatinScene, model: ChromatinModel) {
  scene = {
    ...scene,
    models: [...scene.models, model],
  };
  return scene;
}

function getChromosome(model: ChromatinModel, chrName: string): ChromatinPart | null {
  for (let part of model.parts) {
    if (part.label == chrName) {
      return part;
      //TODO: what if more parts modeling the same chromosome?
    }
  }
  return null; //~ not found...
}

function getChromosomeAtCoordinates(
  model: ChromatinModel, chrName: string, start: number, end: number) 
{
  let newPart: ChromatinPart | null = null;
  for (let part of model.parts) {

    //~ first finding the specified chromosome
    if (chrName != part.label) {
      continue;
    }

    const binStartIndex = coordinateToBin(start, part.resolution, part.coordinates.start);
    const binEndIndex = coordinateToBin(end, part.resolution, part.coordinates.start);

    newPart = {
      chunk: {
        bins: part.chunk.bins.slice(binStartIndex, binEndIndex),
        rawBins: part.chunk.rawBins.slice(binStartIndex, binEndIndex),
        id: -1,
      },
      coordinates: {
        start: start, //TODO: adjust for any range clipping
        end: end, //TODO: adjust for any range clipping
      },
      resolution: part.resolution,
    };
  }

  return newPart;
}

/**
 * Query for model parts on specified genomic coordinates
 * @param coordinates, e.g., "chr1:10000000-12000000"
 * @returns chromatin part, i.e., bins corresponding to the genomic coordinates
 */
export function get(
  model: ChromatinModel,
  coordinates: string,
): ChromatinPart | null {
  console.log(`getRange with ${model} and ${coordinates}`);
    
  //~ Possibly just a chromosome name (without any coordinates)
  //~ => return the whole part
  if (!coordinates.includes(":")) {
    const chromosomeName = coordinates.trim()
    return getChromosome(model, chromosomeName);
  }

  //~ Otherwise: there are coordinates to check too
  const toks = coordinates.split(":");
  const chr = toks[0];
  const coords = toks[1];
  const start = parseInt(coords.split("-")[0]);
  const end = parseInt(coords.split("-")[1]);

  return getChromosomeAtCoordinates(model, chr, start, end);
}

/*
 * Fetched a bin range from model.
 * - absolute for the whole model: bins of each part are concatenated based on order of parts
 */
export function getBinsFromModel(
  model: ChromatinModel,
  start: number,
  end: number,
): ChromatinModel | null {
  /*
   * I actually have a choice here:
   * 1) just make the selection into a big "anonymous" part, without any separation of different parts
   * 2) maintain the separation into parts and essentially just return a new model
   *
   * now that I think about it, only 2) really makes sense: I can't concatenate two parts because that would create a connection.
   */

  let newModel: ChromatinModel = {
    ...model,
    parts: [],
  };
  // let newPart: ChromatinPart | null = null;
  let currentOffset = 0;
  for (let p of model.parts) {
    const startIndex = start - currentOffset;
    const endIndex = Math.min(p.chunk.bins.length, end - currentOffset);
    currentOffset = endIndex;
    const newPart = {
      chunk: {
        ...p.chunk, //TODO: probably I'll want a different id...
        bins: p.chunk.bins.slice(startIndex, endIndex),
        rawBins: p.chunk.rawBins.slice(startIndex, endIndex),
      },
      coordinates: p.coordinates, //TODO: needs actually converting
      resolution: p.resolution,
    };
    newModel.parts.push(newPart);
  }

  return newModel;
}

export function getBinsFromPart(
  part: ChromatinPart,
  start: number,
  end: number,
): ChromatinPart | null {
  const clamp = (val: number, min: number, max: number) =>
    Math.max(Math.min(max, val), min);

  //~ range guards
  const n = part.chunk.bins.length;
  const startIndex = clamp(start, 0, n - 1);
  const endIndex = clamp(end, 0, n - 1);

  const newPart = {
    chunk: {
      ...part.chunk, //TODO: probably I'll want a different id...
      bins: part.chunk.bins.slice(startIndex, endIndex),
      rawBins: part.chunk.rawBins.slice(startIndex, endIndex),
    },
    coordinates: part.coordinates, //TODO: needs actually converting
    resolution: part.resolution,
  };
  return newPart;
}


export function display(scene: ChromatinScene, config?: ChromatinSceneConfig): [ChromatinBasicRenderer, HTMLCanvasElement] {
  const renderer = new ChromatinBasicRenderer();
  renderer.addScene(scene, config);
  renderer.startDrawing();
  const canvas = renderer.getCanvasElement();
  return [renderer, canvas];
}
