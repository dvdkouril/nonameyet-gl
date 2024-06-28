import type { vec3 } from "gl-matrix";

/**
 * A simple list of bin positions.
 * Used in two scenarios:
 *  a) an "anonymous" chunk of chromatin data, and
 *  b) properly annotated part of a larger model (e.g., in whole-genome model, chromosomes will be different chunks).
 */
export type ChromatinChunk = {
  /**
   * bin positions that are actually visualized
   */
  bins: vec3[];
  /**
   * bin positions before any processing (recenter, normalize)
   */
  rawBins: vec3[];

  id: number;
};

/**
 * Coordinates along the genomic sequence.
 */
export type GenomicCoordinates = {
  chromosome: string;
  /* basepair starting position */
  start: number;
  /* basepair ending position */
  end: number;
};

/**
 * Adds information identifying the 3D part on genomic sequence
 */
export type ChromatinPart = {
  chunk: ChromatinChunk;

  coordinates: GenomicCoordinates;
  resolution: number;

  label?: string;
};

/**
 * A full model that contains annotation about which genomic regions the individual parts correspond to
 */
export type ChromatinModel = {
  /* Distinct, separated parts of a chromatin model. Most often single chromosomes. */
  parts: ChromatinPart[];
  /* Identifying organism and genome assembly */
  assembly?: string;
};

export type DisplayableChunk = {
  kind: "chunk";
  structure: ChromatinChunk;
  viewConfig: ViewConfig;
};

/**
 * What this structure should represent is a visual instantiation of a ChromatinModel, with different attributes influencing its visual presentation
 */
export type DisplayableModel = {
  kind: "model";
  /* The 3D structure, just the raw data, nothing about the visual appearance */
  structure: ChromatinModel;
  // signal: ChromatinMappableSignal; //~ placeholder: in the "displayable" it probably makes sense to have the data by which you'll visually modify the 3D structure
  viewConfig: ViewConfig; //~ viewConfig then specifies how the `signal` is mapped to visual attributes of the structure
};

export type AssociatedValues = {
  values: number[];
  min: number;
  max: number;
};

export type AssociatedValuesColor = AssociatedValues & {
  colorScale: string;
};

export type AssociatedValuesScale = AssociatedValues & {
  scaleMin: number;
  scaleMax: number;
};

export type ViewConfig = {
  binSizeScale?: number | AssociatedValuesScale;
  color?: string | AssociatedValuesColor;
  mark?: MarkTypes;
  makeLinks?: boolean;
};

/**
 * Two scenarios in mind:
 *  1. continuous selection along the genomic sequence
 *    - in this case, the `regions` array will just a single selected region
 *  2. selection in 3D (i.e., resulting in many disconnected regions)
 */
export type Selection = {
  regions: GenomicCoordinates[];
  color: string;
  label: string;
};

export type ChromatinSceneConfig = {
  layout: "center" | "grid";
};

export type MarkTypes = "sphere" | "box" | "octahedron";

export type TrackViewConfig = {
  mark: MarkTypes;
  links: boolean;
  color?: string;
};

/**
 * ChromatinScene carries the structures to show, plus a configuration mostly describing the layout of the scene (WIP)
 */
export type ChromatinScene = {
  structures: (DisplayableChunk | DisplayableModel)[];
  config: ChromatinSceneConfig;

  //~ grammar approach
};
