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
  estimateDefaultTubeSize,
} from "../utils";
import { computeTubes, decideGeometry } from "./render-utils";
import type { DrawableMarkSegment } from "./renderer-types";

import type { Color as ChromaColor } from "chroma-js";
// import chroma from "chroma-js";
import type { vec3 } from "gl-matrix";

/**
 * Basic implementation of a 3d chromatin renderer. Essentially just wraps THREE.WebGLRenderer but provides semantics for building chromatin visualization.
 *
 * Important methods:
 *  - addSegments: adding segments of chromatin with unified visual properties (e.g., specified by a grammar)
 *  - buildStructures, buildPart: turns segments with specific visual attributes into THREE primitives
 */
export class ChromatinBasicRenderer {
  markSegments = new Map<string, DrawableMarkSegment[]>();

  scenes: THREE.Scene[] = [];
  composers: EffectComposer[] = []; //~ TODO: two possible improvements: 1) reuse composers and only change camera/scene, 2) store the composer with the scene somehow?

  //~ threejs stuff
  renderer: THREE.WebGLRenderer;
  // scene: THREE.Scene;
  // camera: THREE.PerspectiveCamera;
  // composer: EffectComposer;
  // ssaoPasses: [N8AOPostPass, N8AOPostPass];
  meshes: THREE.InstancedMesh[] = [];

  //~ dom
  redrawRequest = 0;
  updateCallback: ((text: string) => void) | undefined;

  alwaysRedraw = false;
  hoverEffect = false;

  //~ interactions
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2(1, 1);
  /* returns a tuple of [segment index, bin index] of hovered bin */
  hoveredBinId: [number, number] | undefined = undefined;

  constructor(params?: {
    canvas?: HTMLCanvasElement;
    alwaysRedraw?: boolean;
    hoverEffect?: boolean;
  }) {
    const {
      canvas = undefined,
      alwaysRedraw = true,
      hoverEffect = false,
    } = params || {};

    this.renderer = new THREE.WebGLRenderer({
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false,
      alpha: true,
      premultipliedAlpha: false,
      canvas,
    });
    // this.renderer.setClearColor("#00eeee");
    this.renderer.setClearAlpha(0.0);

    this.render = this.render.bind(this);
    this.update = this.update.bind(this);
    this.getCanvasElement = this.getCanvasElement.bind(this);
    this.startDrawing = this.startDrawing.bind(this);
    this.endDrawing = this.endDrawing.bind(this);
    // this.resizeRendererToDisplaySize =
    //   this.resizeRendererToDisplaySize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onKeyPress = this.onKeyPress.bind(this);
    this.setupSSAOPasses = this.setupSSAOPasses.bind(this);

    //~ setting size of canvas to fill parent
    const c = this.getCanvasElement();
    c.id = "global-canvas";
    c.style.position = "fixed"; //~ overlay over the whole viewport
    c.style.left = "0";
    c.style.top = "0";
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.zIndex = "9999"; //~ making sure it is on top of everything (if possible)
    // c.style.border = "10px solid black"; //~ debug:

    this.hoverEffect = hoverEffect;
    this.alwaysRedraw = alwaysRedraw;
    if (!alwaysRedraw) {
      //~ re-render on mouse move: initially, I had redraw on camera change, but since I'm doing effects on hover, I need to redraw more frequently
      document.addEventListener("wheel", this.render);
      document.addEventListener("mousemove", this.render);
    }
    document.addEventListener("mousemove", this.onMouseMove);
    //~ debug: trigger render only on keypress
    document.addEventListener("keypress", this.onKeyPress);
  }

  initNewScene(): THREE.Scene {
    const newScene = new THREE.Scene();
    const newCamera = new THREE.PerspectiveCamera(25, 2, 0.1, 1000);
    const newControls = new OrbitControls(newCamera, this.renderer.domElement);

    newCamera.position.z = 3.0;
    newControls.update();
    newScene.userData.camera = newCamera;

    const newComposer = this.setupSSAOPasses(newScene, newCamera);

    // this.markSegments = []; //~ TODO: temporary solution to solve the structures accumulating with mulptiple scenes

    this.scenes.push(newScene);
    this.composers.push(newComposer);

    return newScene;
  }

  setupSSAOPasses(scene: THREE.Scene, camera: THREE.Camera): EffectComposer {
    const newComposer = new EffectComposer(this.renderer);
    newComposer.addPass(new RenderPass(scene, camera));
    // N8AOPass replaces RenderPass
    const w = 1920;
    const h = 1080;
    const n8aopass = new N8AOPostPass(scene, camera, w, h);
    n8aopass.configuration.aoRadius = 0.1;
    n8aopass.configuration.distanceFalloff = 1.0;
    n8aopass.configuration.intensity = 2.0;
    newComposer.addPass(n8aopass);

    const n8aopassBigger = new N8AOPostPass(scene, camera, w, h);
    n8aopassBigger.configuration.aoRadius = 1.0;
    n8aopassBigger.configuration.distanceFalloff = 1.0;
    n8aopassBigger.configuration.intensity = 2.0;
    newComposer.addPass(n8aopass);

    // this.ssaoPasses = [n8aopass, n8aopassBigger]; //~ TODO: deal with

    /* SMAA Recommended */
    newComposer.addPass(
      new EffectPass(
        camera,
        new SMAAEffect({
          preset: SMAAPreset.ULTRA,
        }),
      ),
    );

    return newComposer;
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Returns a pair [segment id, bin id] to identify hovered bin
   */
  getHoveredBin(): [number, number] | undefined {
    return this.hoveredBinId;
  }

  addUpdateHUDCallback(cb: (text: string) => void) {
    this.updateCallback = cb;
  }

  /**
   * Entrypoint for adding actual data to show
   */
  addSegments(newSegments: DrawableMarkSegment[], forScene: THREE.Scene) {
    // this.markSegments = [...this.markSegments, ...newSegments];
    const key = forScene.uuid; //~ gonna use the uuid as a key for storing the segments
    const existingSegments = this.markSegments.get(key) || [];
    this.markSegments.set(key, [...existingSegments, ...newSegments]);
    this.buildStructures(forScene);
  }

  /**
   * Turns all drawable segments into THREE objects to be rendered
   */
  buildStructures(forScene: THREE.Scene) {
    forScene.clear();
    const key = forScene.uuid;
    const markSegments = this.markSegments.get(key);
    if (markSegments) {
      for (const segment of markSegments) {
        this.buildPart(segment, forScene);
      }
    } else {
      console.log("trying to build an empty scene...");
    }
  }

  /**
   * Meant to be called directly from client (eg, Observable notebook) to request redraw
   */
  updateViewConfig() {
    //~ TODO: deal with this
    //
    // this.scene.clear();
    // this.buildStructures();
    // this.redrawRequest = requestAnimationFrame(this.render);
  }

  /**
   * Turns a singular segment (ie, position+mark+attributes) into THREEjs objects for rendering
   */
  buildPart(segment: DrawableMarkSegment, forScene: THREE.Scene) {
    const {
      color, //TODO: these don't make sense now to be undefined eveer
      // size = undefined,
      makeLinks = true,
    } = segment.attributes;

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

      dummyObj.position.set(b[0], b[1], b[2]);
      dummyObj.scale.setScalar(scaleOfThisBin);
      dummyObj.updateMatrix();
      meshInstcedSpheres.setMatrixAt(i, dummyObj.matrix);
      meshInstcedSpheres.setColorAt(i, colorOfThisBin);
    }
    forScene.add(meshInstcedSpheres);
    this.meshes.push(meshInstcedSpheres);

    if (makeLinks) {
      const tubeSize = estimateDefaultTubeSize(segment);
      this.buildLinks(segment.positions, tubeSize, color, forScene);
    }
  }

  /**
   * Utility function for building links between marks (optional)
   */
  buildLinks(
    positions: vec3[],
    tubeSize: number,
    color: ChromaColor | ChromaColor[],
    forScene: THREE.Scene,
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

    const dummyObj = new THREE.Object3D();
    const colorObj = new THREE.Color();
    for (const [i, tube] of tubes.entries()) {
      dummyObj.position.set(tube.position.x, tube.position.y, tube.position.z);
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
    forScene.add(meshInstcedTubes);
  }

  updateColor(meshIndex: number, color: ChromaColor | ChromaColor[]) {
    const mesh = this.meshes[meshIndex];
    const colorObj = new THREE.Color();

    for (let i = 0; i < mesh.count; i++) {
      //~ narrowing: ChromaColor or ChromaColor[]
      if (Array.isArray(color)) {
        colorObj.set(color[i].hex());
      } else {
        colorObj.set(color.hex());
      }
      mesh.setColorAt(i, colorObj);
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
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
      for (const c of this.composers) {
        c.setSize(width, height);
      }
      // const [pass1, pass2] = this.ssaoPasses;
      // pass1.setSize(width, height);
      // pass2.setSize(width, height);
    }
    return needResize;
  }

  update() {
    //~ TODO: deal with, if we want to keep...
    //
    // this.raycaster.setFromCamera(this.mouse, this.camera);
    //
    // this.hoveredBinId = undefined;
    // for (const [i, m] of this.meshes.entries()) {
    //   const intersection = this.raycaster.intersectObject(m);
    //   if (intersection.length > 0) {
    //     const instanceId = intersection[0].instanceId;
    //     if (instanceId) {
    //       this.hoveredBinId = [i, instanceId];
    //       if (this.updateCallback) {
    //         this.updateCallback(`Hovered: part ${i}, bin ${instanceId}`);
    //       }
    //     }
    //   } else {
    //     if (this.updateCallback) {
    //       this.updateCallback("");
    //     }
    //   }
    // }
    //
    // //~ color neighboring sequence
    // if (this.hoverEffect) {
    //   if (this.hoveredBinId) {
    //     const [segmentId, binId] = this.hoveredBinId;
    //     const segment = this.markSegments[segmentId];
    //
    //     const min = -50;
    //     const max = 50;
    //     const colorScale = chroma.scale(["yellow", "red", "yellow"]);
    //     const N = segment.positions.length;
    //     const indices = Array.from({ length: N + 1 }, (_, i) => i - binId);
    //     const color = indices.map((v) => colorScale.domain([min, max])(v));
    //
    //     this.updateColor(segmentId, color);
    //   } else {
    //     //~ reset all
    //     for (const [i, s] of this.markSegments.entries()) {
    //       this.updateColor(i, s.attributes.color);
    //     }
    //   }
    // }
  }

  render() {
    // this.canvas.style.transform = `translateY(${window.scrollY}px)`;
    console.log("ChromatinBasicRenderer::render()");
    // this.redrawRequest = requestAnimationFrame(this.render);
    const c = this.getCanvasElement();
    c.style.transform = `translateY(${window.scrollY}px)`;
    // console.log(this.renderer.getSize());

    this.renderer.setClearColor(0xffffff);
    this.renderer.setClearAlpha(0.0); //~
    this.renderer.setScissorTest(false);
    this.renderer.clear();

    // this.renderer.setClearColor(0xe0e0e0);
    this.renderer.setClearColor(0x00aa00);
    this.renderer.setScissorTest(true);

    //~ from: https://github.com/mrdoob/three.js/blob/master/examples/webgl_multiple_elements.html
    for (const [i, s] of this.scenes.entries()) {
      // get the element that is a place holder for where we want to
      // draw the scene
      const element = s.userData.element as HTMLElement;
      console.log(`rendering scene ${i} (${s.uuid})`);
      console.log(`objects in scene: ${s.children.length}`);
      for (const [i, o] of s.children.entries()) {
        console.log(`[${i}]: ${o.type} ${o.uuid}`);
      }

      // get its position relative to the page's viewport
      const rect = element.getBoundingClientRect();
      // check if it's offscreen. If so skip it
      // if (
      //   rect.bottom < 0 ||
      //   rect.top > this.renderer.domElement.clientHeight ||
      //   rect.right < 0 ||
      //   rect.left > this.renderer.domElement.clientWidth
      // ) {
      //   continue; // it's off screen
      // }
      // set the viewport

      const pixelRatio = window.devicePixelRatio;
      const width = (rect.right - rect.left) * pixelRatio;
      const height = (rect.bottom - rect.top) * pixelRatio;
      const left = rect.left * pixelRatio;
      const bottom =
        pixelRatio * (this.renderer.domElement.clientHeight - rect.bottom);

      this.renderer.setViewport(left, bottom, width, height);
      this.renderer.setScissor(left, bottom, width, height);
      console.log(`l: ${left}, b: ${bottom}, w: ${width}, h: ${height}`);

      // const camera = s.userData.camera;
      const composer = this.composers[i];
      // composer.getRenderer().setViewport(left, bottom, width, height);
      // composer.getRenderer().setScissor(left, bottom, width, height);
      //
      //
      //~ from: https://threejs.org/manual/#en/responsive
      const camera = s.userData.camera as THREE.PerspectiveCamera;
      if (this.resizeRendererToDisplaySize(this.renderer)) {
        const canvas = this.renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
      }

      composer.render();
    }

    //~ TODO: is there anything that I still need here?
    //
    // if (this.alwaysRedraw) {
    //   this.redrawRequest = requestAnimationFrame(this.render);
    // }
    //
    // this.update();
    //
    // //~ from: https://threejs.org/manual/#en/responsive
    // if (this.resizeRendererToDisplaySize(this.renderer)) {
    //   const canvas = this.renderer.domElement;
    //   this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    //   this.camera.updateProjectionMatrix();
    // }
    //
    // this.composer.render();
  }

  onMouseMove(event: MouseEvent) {
    event.preventDefault();
    const canvas = this.renderer.domElement;

    /* deal with canvas that's offset, not fullscreen */
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.x;
    const y = event.clientY - rect.y;

    /* mouse.x/y should be both in <-1,1> */
    this.mouse.x = (x / rect.width) * 2 - 1;
    this.mouse.y = -(y / rect.height) * 2 + 1;
  }

  onKeyPress(event: KeyboardEvent) {
    if (event.key === "r") {
      console.log("rendering triggered...");
      this.render();
    }
  }
}
