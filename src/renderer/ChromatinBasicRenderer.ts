// @ts-ignore
import { N8AOPostPass } from "n8ao";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from "postprocessing";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  decideVisualParametersBasedOn1DData,
  estimateBestSphereSize,
} from "../utils";
import { computeTubes, decideGeometry } from "./render-utils";
import type { DrawableMarkSegment } from "./renderer-types";

import type { Color as ChromaColor } from "chroma-js";
import { vec3 } from "gl-matrix";
import { ChromatinSceneConfig } from "../chromatin-types";

/**
 * Basic implementation of a 3d chromatin renderer. Essentially just wraps THREE.WebGLRenderer but provides semantics for building chromatin visualization.
 *
 * Important methods:
 *  - addSegments: adding segments of chromatin with unified visual properties (e.g., specified by a grammar)
 *  - buildStructures, buildPart: turns segments with specific visual attributes into THREE primitives
 */
export class ChromatinBasicRenderer {
  markSegments: DrawableMarkSegment[] = [];

  //~ threejs stuff
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  ssaoPasses: [N8AOPostPass, N8AOPostPass];

  //~ dom
  redrawRequest = 0;

  alwaysRedraw = false;
  sceneConfig: ChromatinSceneConfig = {
    layout: "center",
  };

  constructor(params?: {
    canvas?: HTMLCanvasElement;
    alwaysRedraw?: boolean;
  }) {
    const { canvas = undefined, alwaysRedraw = true } = params || {};

    this.renderer = new THREE.WebGLRenderer({
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false,
      canvas,
    });
    this.renderer.setClearColor("#eeeeee");
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(25, 2, 0.1, 1000);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);

    this.camera.position.z = 3.0;
    controls.update();

    const lightA = new THREE.DirectionalLight();
    lightA.position.set(3, 10, 10);
    lightA.castShadow = true;
    const lightB = new THREE.DirectionalLight();
    lightB.position.set(-3, 10, -10);
    lightB.intensity = 0.2;
    const lightC = new THREE.AmbientLight();
    lightC.intensity = 0.2;
    this.scene.add(lightA, lightB, lightC);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // N8AOPass replaces RenderPass
    const w = 1920;
    const h = 1080;
    const n8aopass = new N8AOPostPass(this.scene, this.camera, w, h);
    n8aopass.configuration.aoRadius = 0.1;
    n8aopass.configuration.distanceFalloff = 1.0;
    n8aopass.configuration.intensity = 2.0;
    this.composer.addPass(n8aopass);

    const n8aopassBigger = new N8AOPostPass(this.scene, this.camera, w, h);
    n8aopassBigger.configuration.aoRadius = 1.0;
    n8aopassBigger.configuration.distanceFalloff = 1.0;
    n8aopassBigger.configuration.intensity = 2.0;
    this.composer.addPass(n8aopass);

    this.ssaoPasses = [n8aopass, n8aopassBigger];

    /* SMAA Recommended */
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new SMAAEffect({
          preset: SMAAPreset.ULTRA,
        }),
      ),
    );

    this.render = this.render.bind(this);
    this.getCanvasElement = this.getCanvasElement.bind(this);
    this.startDrawing = this.startDrawing.bind(this);
    this.endDrawing = this.endDrawing.bind(this);
    this.resizeRendererToDisplaySize =
      this.resizeRendererToDisplaySize.bind(this);

    //~ setting size of canvas to fill parent
    const c = this.getCanvasElement();
    c.style.width = "100%";
    c.style.height = "100%";

    this.alwaysRedraw = alwaysRedraw;
    if (!alwaysRedraw) {
      controls.addEventListener("change", this.render);
    }
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setConfig(sceneConfig: ChromatinSceneConfig) {
    this.sceneConfig = sceneConfig;
  }

  /**
   * Entrypoint for adding actual data to show
   */
  addSegments(newSegments: DrawableMarkSegment[]) {
    this.markSegments = [...this.markSegments, ...newSegments];
    this.buildStructures();
  }

  /**
   * Turns all drawable segments into THREE objects to be rendered
   */
  buildStructures() {
    this.scene.clear();
    for (const [i, segment] of this.markSegments.entries()) {
      this.buildPart(segment, i);
    }

    //~ hovered indicator
    const a = 1.0;
    const indicatorGeom = new THREE.BoxGeometry(a, a, a);
    const m = new THREE.MeshBasicMaterial({ color: "#000000" });
    m.wireframe = true;
    const indicator = new THREE.Mesh(indicatorGeom, m);
    indicator.position.set(0, 0, 0);
    this.scene.add(indicator);
  }

  /**
   * Meant to be called directly from client (eg, Observable notebook) to request redraw
   */
  updateViewConfig() {
    this.scene.clear();
    this.buildStructures();
    this.redrawRequest = requestAnimationFrame(this.render);
  }

  calculateGridPositions(i: number, N: number): [x: number, y: number] {
    //~ get the best aspect ratio:
    const xDim = Math.floor(Math.sqrt(N));

    let x = i % xDim;
    let y = Math.floor(i / xDim);
    return [x, y];
  }

  /**
   * Turns a singular segment (ie, position+mark+attributes) into THREEjs objects for rendering
   */
  buildPart(segment: DrawableMarkSegment, index: number) {
    const {
      color, //TODO: these don't make sense now to be undefined eveer
      // size = undefined,
      makeLinks = true,
    } = segment.attributes;

    const N = this.markSegments.length;
    const [gridX, gridY] = this.calculateGridPositions(index, N);
    // const rndNum = Math.random() * 1 - 1;
    const gScale = 1.0 / Math.floor(Math.sqrt(N)); //~ I don't want the scale to be 0
    const gPos = vec3.fromValues(gridX * gScale - 0.5, gridY * gScale - 0.5, 0);
    // const gScale = 0.2; //~ I don't want the scale to be 0

    const sphereRadius = estimateBestSphereSize(segment.positions);

    //~ make the threejs objects
    const g = decideGeometry(segment.mark);
    const m = new THREE.MeshBasicMaterial({ color: "#FFFFFF" });
    const n = segment.positions.length;
    const meshInstcedSpheres = new THREE.InstancedMesh(g, m, n);
    const dummyObj = new THREE.Object3D();

    //~ iterating over bins in the current segment
    for (const [i, b] of segment.positions.entries()) {
      const [colorOfThisBin, scaleOfThisBin] =
        decideVisualParametersBasedOn1DData(segment, i);

      dummyObj.position.set(gPos[0] + gScale * b[0], gPos[1] + gScale * b[1], gPos[2] + gScale * b[2]);
      dummyObj.scale.setScalar(scaleOfThisBin * gScale);
      dummyObj.updateMatrix();
      meshInstcedSpheres.setMatrixAt(i, dummyObj.matrix);
      meshInstcedSpheres.setColorAt(i, colorOfThisBin);
    }
    this.scene.add(meshInstcedSpheres);

    if (makeLinks) {
      const tubeSize = 0.4 * sphereRadius;
      this.buildLinks(segment.positions, tubeSize, color, gPos);
    }
  }

  /**
   * Utility function for building links between marks (optional)
   */
  buildLinks(
    positions: vec3[],
    tubeSize: number,
    color: ChromaColor | ChromaColor[],
    partPosition: vec3,
  ) {
    //~ tubes between tubes
    const tubes = computeTubes(positions);
    const tubeGeometry = new THREE.CylinderGeometry(
      tubeSize,
      tubeSize,
      1.0,
      10,
      1,
    );
    const material = new THREE.MeshBasicMaterial({ color: "#FFFFFF" });

    const meshInstcedTubes = new THREE.InstancedMesh(
      tubeGeometry,
      material,
      tubes.length,
    );

    const p= partPosition;

    const dummyObj = new THREE.Object3D();
    const colorObj = new THREE.Color();
    for (const [i, tube] of tubes.entries()) {
      dummyObj.position.set(tube.position.x + p[0], tube.position.y + p[1], tube.position.z + p[2]);
      dummyObj.rotation.set(
        tube.rotation.x,
        tube.rotation.y,
        tube.rotation.z,
        tube.rotation.order,
      );
      dummyObj.scale.setY(tube.scale);
      dummyObj.updateMatrix();

      //~ narrowing: ChromaColor or ChromaColor[]
      if (Array.isArray(color)) {
        colorObj.set(color[i].hex());
        color;
      } else {
        colorObj.set(color.hex());
      }

      meshInstcedTubes.setMatrixAt(i, dummyObj.matrix);
      meshInstcedTubes.setColorAt(i, colorObj);
    }
    this.scene.add(meshInstcedTubes);
  }

  startDrawing() {
    this.redrawRequest = requestAnimationFrame(this.render);
  }

  endDrawing() {
    cancelAnimationFrame(this.redrawRequest);
    this.renderer.dispose();
  }

  resizeRendererToDisplaySize(renderer: THREE.WebGLRenderer): boolean {
    const canvas = renderer.domElement;
    const pixelRatio = window.devicePixelRatio;
    const width = Math.floor(canvas.clientWidth * pixelRatio);
    const height = Math.floor(canvas.clientHeight * pixelRatio);
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
      this.composer.setSize(width, height);
      const [pass1, pass2] = this.ssaoPasses;
      pass1.setSize(width, height);
      pass2.setSize(width, height);
    }
    return needResize;
  }

  render() {
    if (this.alwaysRedraw) {
      this.redrawRequest = requestAnimationFrame(this.render);
    }

    console.log("drawing");

    //~ from: https://threejs.org/manual/#en/responsive
    if (this.resizeRendererToDisplaySize(this.renderer)) {
      const canvas = this.renderer.domElement;
      this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
      this.camera.updateProjectionMatrix();
    }

    this.composer.render();
  }
}
