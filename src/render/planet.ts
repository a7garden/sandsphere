import {ClimateLayers} from './climateLayers';
import {arcFromBasis,arcFromCells,snapSectionEndpoint,type SectionArc} from './sectionArc';
import {buildSectionMesh} from './sectionGeometry';
import {CellBrush} from './cellBrush';
import type {WeatherClimate,ClimateLayer} from '../sim/weatherClimate';
import type {CloudStyle} from './cloudBanks';
import {vegetationCover} from './vegetation';
import {Biosphere} from './biosphere';
import {solarMaterial} from './solar';
import {SystemScene} from './system';
import type {PlanetRecord} from '../sim/system';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3,Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3,Matrix,Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import { F,STRIDE,SURFACE_MATERIALS,solidHeight,gravityMultiplier,type SurfaceMaterial,type GasMaterial,type Environment,DEFAULT_ENVIRONMENT } from '../sim/model';
import {GASES,atmosphereState,type AtmosphereState} from '../sim/atmosphere';
import { HEIGHT_SCALE,RADIUS,nearestCell,NEIGHBORS,INVALID,type SphereGrid } from '../sim/sphere';
import { dualSurface,shorelineDepths,softenShore,clipWater,facetWater,type WetVertex } from './surface';
import {SurfaceEffects} from './effects';
import {SkyLayers} from './sky';
import {WeatherParticles} from './weather';
import {PrecipitationLayer} from './precipitationLayer';
import {materialGrain} from './particles';
import {surfaceMaterial} from './materials';
import type {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {atmosphereOptics} from '../sim/optics';
import {advanceFalling,physicalContact,type FallingGrain} from '../sim/falling';
import {altitude,columnGeometry} from './columnGeometry';
import {renderScaling} from './budget';
import {RotationFrame} from './rotationFrame';
import {OrbitDisplay,type MotionSnapshot} from './orbitDisplay';
import {orbitalSun} from '../sim/orbit';
import {AxisAlignment,cameraFrameDirection} from './axisAlignment';
import {sceneMarker} from './sceneMarker';
import {orbitAngles} from './orbitAngles';
import {SectionCamera} from './sectionCamera';
import type {SectionSamples} from './sectionGeometry';
import {SectionView} from './sectionView';
import {SectionProjection} from './sectionProjection';
import {SectionMaterials} from './sectionMaterials';
import {Ray} from '@babylonjs/core/Culling/ray';
import {updateSectionClip,sectionClipStats,setSectionProjection} from './sectionClip';
import {SimulationRandom} from '../sim/random';

const PALETTE={
  soil:[.40,.33,.22],plant:[.24,.44,.19],herbivore:[.77,.61,.38],carnivore:[.48,.30,.20],iron:[.36,.40,.43],
  rock:[0.73,0.75,0.70],sand:[0.94,0.81,0.57],clay:[0.73,0.46,0.32],
  ceramic:[0.79,0.40,0.23],glass:[0.46,0.73,0.67],ice:[0.88,0.96,0.97],
  salt:[0.99,0.97,0.91],water:[0.24,0.60,0.73],molten:[1,0.37,0.12],
  paper:[0.9608,0.9608,0.9490],dark:[0.09,0.105,0.12],line:[0.77,0.77,0.72],
} as const;
type Grain=FallingGrain;

export class PlanetView {
  private rotationFrame=new RotationFrame();
  private motion:MotionSnapshot|null=null;
  private motionDisplay:OrbitDisplay|null=null;
  private physicalSun:readonly number[]=[1,0,0];
  private spinTilt=0;
  private focusFlight:{cell:number;time:number;alpha:number;beta:number}|null=null;
  private physicalRandom=new SimulationRandom(0x971fc31);
  readonly engine:AbstractEngine;
  readonly scene:Scene;
  readonly camera:ArcRotateCamera;
  private systemScene:SystemScene;
  private systemParticles=true;
  private systemFlightId=0;
  private biosphere:Biosphere;
  private surfaceTime=0;
  private facetedSurface=false;
  private hexagonalSurface=false;
  private solar:ShaderMaterial;
  private meteorFlight:{mesh:Mesh;trail:Mesh;from:Vector3;to:Vector3;t:number;resolve:()=>void}|null=null;
  readonly terrain:Mesh;
  private water:Mesh;
  private hexBanks:Mesh;
  private terrainMaterial:ShaderMaterial;
  private waterMaterial:ShaderMaterial;
  private displayHeights:Float32Array;
  private root:TransformNode;
  private heatSurface:Mesh;
  private cellBrush:CellBrush;
  private heatColors:Float32Array;
  private heatPositions:Float32Array;
  private surfaceNormals:Float32Array;
  private previousVapor:Float32Array;
  private previousLiquid:Float32Array;
  private effects:SurfaceEffects;
  private sky:SkyLayers;
  private weather:WeatherParticles;
  private precipitationLayer:PrecipitationLayer;
  private renderRadii:Float32Array;
  private atmosphereVisible=true;
  private sun:Mesh;
  private sunRays:LinesMesh;
  private spinAxis:Mesh;
  private showSpinAxis=true;
  private axisAlignment:AxisAlignment;
  private atmosphere:LinesMesh[];
  private environment:Environment={...DEFAULT_ENVIRONMENT};
  private atmosphereInfo:AtmosphereState;
  private atmosphereRadii=[0];
  private stars:Mesh;
  private stream:Mesh;
  private streamPath:Vector3[]|null=null;
  private streamLife=0;
  private terrainData:Float32Array;
  private waterData:Float32Array;
  private colors:Float32Array;
  private surfaceInfo:Float32Array;
  private waterColors:Float32Array;
  private normals:Float32Array;
  private waterNormals:Float32Array;
  private surface:ReturnType<typeof dualSurface>;
  private surfaceState:Float32Array;
  private sectionSamples:SectionSamples;
  sectionNavigation:'rotate'|'pan'='rotate';
  onSectionChange:(()=>void)|undefined;
  private surfaceDepths:Float32Array;
  private groundCover:Float32Array;
  private shoreHeight:Float32Array;
  private shoreDepth:Float32Array;
  private vertexTerrain:Float32Array;
  private vertexWater:Float32Array;
  private terrainIndices:Uint32Array;
  private state:Float32Array;
  private grains:Grain[]=[];
  private escapedGrains=0;
  private grainMeshes=new Map<SurfaceMaterial,Mesh>();
  private grainMatrices=new Map<SurfaceMaterial,Float32Array>();
  private ray=Vector3.Zero();
  private keyLight:DirectionalLight;
  private ground:Mesh;
  private orbit:Mesh;
  private themeDark=false;
  private resize:ResizeObserver;
  private readyCallback:()=>void=()=>{};
  private sectionCamera:SectionCamera;
  private climateLayers!:ClimateLayers;
  private climateState:WeatherClimate|null=null;
  private sectionView:SectionView;
  private sectionProjection:SectionProjection;
  private sectionMaterials:SectionMaterials;
  private selectionArc:SectionArc|null=null;private selectionControlBasis:SectionArc|null=null;
  private selectionCells:number[]=[];
  private selectionEndCells:{a:number;b:number}|null=null;private selectionWindowRange=0;
  private selectionCellSet=new Set<number>();
  private selectionEditing=false;
  private selectionPending=false;private selectionPendingIndex:number|undefined;
  private selectionBefore:{arc:SectionArc|null;cells:number[];ends:{a:number;b:number}|null;range:number}|null=null;
  private selectionSpinFrozen=false;
  private selectionBrush:CellBrush;
  private selectionLine:LinesMesh;
  private sectionRangeCells=12;
  private sectionMagnificationMode=0;private sectionHeightTarget=1;private sectionFitPending=true;
  private sectionDirty=true;
  private sectionWidth=-1;
  private sectionNormal=Vector3.Zero();private sectionUp=Vector3.Zero();
  private inspectionMode=true;
  private sectionControlsDetached=false;
  private constructor(readonly canvas:HTMLCanvasElement,readonly grid:SphereGrid,state:Float32Array,engine:AbstractEngine,renderRefinement=0) {
    this.state=state;this.atmosphereInfo=atmosphereState(state,this.environment);this.engine=engine;this.scene=new Scene(engine);this.root=new TransformNode('rotating planet',this.scene);
    this.scene.clearColor=new Color4(...PALETTE.paper,1);
    this.scene.imageProcessingConfiguration.toneMappingEnabled=false;
    this.camera=new ArcRotateCamera('observer',-1.01,1.17,16.4,Vector3.Zero(),this.scene);
    this.axisAlignment=new AxisAlignment(this.camera);
    this.camera.fovMode=canvas.clientWidth<canvas.clientHeight?Camera.FOVMODE_HORIZONTAL_FIXED:Camera.FOVMODE_VERTICAL_FIXED;
    this.systemScene=new SystemScene(this.scene,this.camera,grid);
    this.camera.minZ=0.1;this.camera.lowerRadiusLimit=7.1;this.camera.upperRadiusLimit=24;
    this.camera.lowerBetaLimit=0.12;this.camera.upperBetaLimit=Math.PI-0.12;
    this.camera.wheelPrecision=38;this.camera.pinchPrecision=50;
    this.camera.inertia=0.65;this.camera.panningSensibility=0;
    this.camera.attachControl(canvas,true);
    // Babylon 9 maps right drag to pan independently of the pointer button filter.
    // Bind both allowed inspection gestures to rotation; painting keeps button 0 disabled.
    this.camera.movement.input.inputMap=this.camera.movement.input.inputMap.filter(entry=>entry.source!=='pointer');
    this.camera.movement.input.addEntry({source:'pointer',button:0,interaction:'rotate'});
    this.camera.movement.input.addEntry({source:'pointer',button:2,interaction:'rotate'});
    const pointers=this.camera.inputs.attached.pointers;
    if(pointers && 'buttons' in pointers) (pointers as {buttons:number[]}).buttons=[2];
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.sectionCamera=new SectionCamera(this.camera,this.root);
    this.sectionProjection=new SectionProjection(this.scene);setSectionProjection(this.scene,this.sectionProjection);
    this.sectionMaterials=new SectionMaterials(this.scene,this.root,this.sectionProjection);
    this.sectionCamera.setFlatRange(this.sectionHalfRange);
    const fill=new HemisphericLight('sky',new Vector3(0.2,1,0.3),this.scene);
    fill.intensity=0.45;fill.groundColor=new Color3(0.48,0.54,0.6);
    this.keyLight=new DirectionalLight('sun',new Vector3(0.55,-0.9,-0.35),this.scene);
    this.keyLight.intensity=1.0;
    this.biosphere=new Biosphere(this.scene,this.root,grid);
    this.surface=dualSurface(grid,renderRefinement);
    this.cellBrush=new CellBrush(this.scene,this.root,grid,this.surface);
    this.selectionBrush=new CellBrush(this.scene,this.root,grid,this.surface,'selected section cells',0);
    this.selectionLine=MeshBuilder.CreateLines('selected section arc',{points:Array.from({length:65},()=>Vector3.Zero()),updatable:true},this.scene);
    this.selectionLine.parent=this.root;this.selectionLine.isPickable=false;this.selectionLine.color=new Color3(.4,.85,1);this.selectionLine.alpha=.4;this.selectionLine.setEnabled(false);
    const vertices=this.surface.indices.length;
    this.surfaceState=new Float32Array(this.surface.count*STRIDE);
    this.sectionSamples={cellOwners:new Uint32Array(this.surface.count),baseHeights:new Float32Array(this.surface.count),solidRadii:new Float32Array(this.surface.count),mobileWater:new Float32Array(this.surface.count),triangleVertices:this.surface.indices,bedrockHeights:new Float32Array(this.surface.count)};
    for(let i=0;i<this.surface.count;i++){
      this.sectionSamples.cellOwners[i]=nearestCell(grid,this.surface.directions[i*3],this.surface.directions[i*3+1],this.surface.directions[i*3+2]);
      if(i<grid.count)this.sectionSamples.baseHeights[i]=grid.geometry[i*4+3];
      else {const a=this.surface.parents[i*2],b=this.surface.parents[i*2+1],c=this.surface.third[i];this.sectionSamples.baseHeights[i]=(this.sectionSamples.baseHeights[a]+this.sectionSamples.baseHeights[b]+(c>=0?this.sectionSamples.baseHeights[c]:0))/(c>=0?3:2);}
    }
    this.groundCover=new Float32Array(this.surface.count);this.surfaceDepths=new Float32Array(this.surface.count);this.shoreHeight=new Float32Array(this.surface.count);this.shoreDepth=new Float32Array(this.surface.count);
    this.vertexTerrain=new Float32Array(this.surface.count*3);
    this.vertexWater=new Float32Array(this.surface.count*3);
    this.terrainData=new Float32Array(vertices*3);
    this.waterData=new Float32Array(vertices*2*3);
    this.normals=new Float32Array(vertices*3);
    this.waterNormals=new Float32Array(vertices*2*3);
    this.colors=new Float32Array(vertices*4);this.surfaceInfo=new Float32Array(vertices*4);
    this.waterColors=new Float32Array(vertices*2*4);
    this.displayHeights=new Float32Array(this.surface.count);
    this.heatColors=new Float32Array(vertices*4);this.heatPositions=new Float32Array(vertices*3);
    this.surfaceNormals=new Float32Array(this.surface.count*3);
    this.previousVapor=Float32Array.from({length:grid.count},(_,i)=>state[i*STRIDE+F.vapor]);
    this.previousLiquid=Float32Array.from({length:grid.count},(_,i)=>state[i*STRIDE+F.water]);
    this.terrainIndices=Uint32Array.from({length:vertices},(_,i)=>i);
    this.terrain=new Mesh('continuous terrain',this.scene);
    this.water=new Mesh('surface water',this.scene);
    this.terrain.parent=this.root;this.water.parent=this.root;
    const material=this.terrainMaterial=surfaceMaterial(this.scene,'terrain');
    this.terrain.material=material;this.terrain.useVertexColors=true;
    this.hexBanks=new Mesh('hexagonal coastal banks',this.scene);this.hexBanks.parent=this.root;this.hexBanks.material=material;this.hexBanks.useVertexColors=true;this.hexBanks.isPickable=false;
    const liquid=this.waterMaterial=surfaceMaterial(this.scene,'water');
    this.water.material=liquid;this.water.useVertexColors=true;this.water.hasVertexAlpha=false;
    this.water.isPickable=true;this.water.renderingGroupId=1;
    this.scene.setRenderingAutoClearDepthStencil(1,false);
    this.scene.setRenderingAutoClearDepthStencil(2,false);
    for(const mesh of [this.terrain,this.water]) {
      const data=new VertexData();
      const isWater=mesh===this.water;
      data.positions=isWater?this.waterData:this.terrainData;
      data.normals=isWater?this.waterNormals:this.normals;
      data.indices=isWater?Uint32Array.from({length:vertices*2},(_,i)=>i):this.terrainIndices;
      data.colors=isWater?this.waterColors:this.colors;
      if(!isWater) {
        const uv=new Float32Array(vertices*2);
        for(let p=0;p<this.surface.indices.length;p+=3) {
          const coords=[0,1,2].map(k=>{
            const v=this.surface.indices[p+k],x=this.surface.directions[v*3],y=this.surface.directions[v*3+1],z=this.surface.directions[v*3+2];
            return [Math.atan2(z,x)/(Math.PI*2)+.5,Math.acos(y)/Math.PI];
          });
          if(Math.max(...coords.map(v=>v[0]))-Math.min(...coords.map(v=>v[0]))>.5)for(const v of coords)if(v[0]<.5)v[0]+=1;
          for(let k=0;k<3;k++)uv.set(coords[k],(p+k)*2);
        }
        data.uvs=uv;
      }
      data.applyToMesh(mesh,true);
    }
    this.heatSurface=new Mesh('surface temperature',this.scene);this.heatSurface.parent=this.root;
    const heatMat=new StandardMaterial('heat emission',this.scene,true);
    heatMat.disableLighting=true;heatMat.emissiveColor=Color3.White();heatMat.alphaMode=Constants.ALPHA_ADD;
    heatMat.specularColor=Color3.Black();heatMat.backFaceCulling=true;
    this.heatSurface.material=heatMat;this.heatSurface.hasVertexAlpha=true;this.heatSurface.useVertexColors=true;
    this.heatSurface.isPickable=false;this.heatSurface.renderingGroupId=2;
    const heatData=new VertexData();heatData.positions=this.heatPositions;heatData.indices=this.terrainIndices;heatData.colors=this.heatColors;
    heatData.normals=this.normals;heatData.applyToMesh(this.heatSurface,true);
    this.terrain.setVerticesData('surfaceInfo',this.surfaceInfo,true,4);
    this.effects=new SurfaceEffects(this.scene,this.root);
    this.renderRadii=new Float32Array(grid.count);
    this.sky=new SkyLayers(this.scene,this.root,grid);
    this.terrainMaterial.setTexture('densityMap',this.sky.densityTexture);this.waterMaterial.setTexture('densityMap',this.sky.densityTexture);
    this.weather=new WeatherParticles(this.scene,this.root);
    this.precipitationLayer=new PrecipitationLayer(this.scene,this.root,this.surface.owners,grid.count);
    this.sectionView=new SectionView(this.scene,this.root,grid);this.climateLayers=new ClimateLayers(this.scene,this.root,this.grid);
    this.scene.setRenderingAutoClearDepthStencil(1,false);
    this.scene.setRenderingAutoClearDepthStencil(2,false);
    const points=Array.from({length:161},(_,i)=>{
      const a=i/160*Math.PI*2;
      return new Vector3(Math.cos(a)*5.75,Math.sin(a)*1.2,Math.sin(a)*5.5);
    });
    this.orbit=MeshBuilder.CreateLines('reference ring',{points},this.scene);
    (this.orbit as Mesh & {color:Color3}).color=new Color3(...PALETTE.line);
    this.orbit.isPickable=false;
    this.orbit.setEnabled(false);
    this.spinAxis=MeshBuilder.CreateLines('rotation axis',{points:[new Vector3(0,-6.5,0),new Vector3(0,6.5,0)]},this.scene);
    (this.spinAxis as LinesMesh).color=new Color3(.55,.82,.86);this.spinAxis.parent=this.root;this.spinAxis.isPickable=false;
    this.atmosphere=['atmosphere 1% pressure'].map(name=>{
      const line=MeshBuilder.CreateLines(name,{
        points:Array.from({length:257},(_,i)=>new Vector3(Math.cos(i/256*Math.PI*2),Math.sin(i/256*Math.PI*2),0)),
      },this.scene);
      line.isPickable=false;line.rotationQuaternion=Quaternion.Identity();return line;
    });
    // A sphere's perspective silhouette sits on its tangent plane, rather than through its centre.
    // Updating only the transform keeps the outline round as the inspection camera moves.
    this.scene.onBeforeCameraRenderObservable.add(camera=>{
      if(camera!==this.camera)return;
      const eye=this.camera.position,distance=eye.length();
      for(let k=0;k<this.atmosphere.length;k++) {
        const line=this.atmosphere[k],radius=this.atmosphereRadii[k];
        line.setEnabled(false);if(!line.isEnabled())continue;
        const ratio=radius*radius/(distance*distance);
        line.position.copyFrom(eye).scaleInPlace(ratio);line.scaling.setAll(radius*Math.sqrt(1-ratio));
        Quaternion.FromUnitVectorsToRef(Vector3.Forward(),eye.normalizeToNew(),line.rotationQuaternion!);
      }
    });
    this.sun=MeshBuilder.CreateSphere('sun direction',{diameter:5.2,segments:48},this.scene);
    this.solar=solarMaterial(this.scene);this.sun.material=this.solar;this.sun.isPickable=false;
    this.stream=MeshBuilder.CreateTube('continuous water stream',{path:Array.from({length:13},(_,i)=>new Vector3(0,i*.05,0)),radius:.020,tessellation:10,updatable:true},this.scene);
    const streamMat=new StandardMaterial('flowing water',this.scene,true);streamMat.diffuseColor=new Color3(.38,.67,.78);streamMat.emissiveColor=new Color3(.018,.04,.05);streamMat.specularColor=new Color3(.5,.65,.7);streamMat.specularPower=160;
    this.stream.material=streamMat;this.stream.parent=this.root;this.stream.isPickable=false;this.stream.setEnabled(false);
    this.sunRays=MeshBuilder.CreateLineSystem('sunlight direction',{lines:[0,1,2].map(i=>[new Vector3(i*.05,0,5.8),new Vector3(i*.05,0,6.75)]),updatable:true},this.scene);
    (this.sunRays as Mesh & {color:Color3}).color=new Color3(.67,.54,.32);this.sunRays.isPickable=false;
    // Deterministic stars keep the field stable across reloads; size and colour
    // vary without twinkling UI or an animated background competing with the world.
    let starSeed=731;
    const random=()=>{starSeed=(Math.imul(starSeed,1664525)+1013904223)>>>0;return starSeed/4294967296;};
    const starColors:Color4[][]=[];
    const stars=Array.from({length:900},()=>{
      const y=random()*2-1,a=random()*Math.PI*2,r=Math.sqrt(1-y*y),v=new Vector3(r*Math.cos(a),y,r*Math.sin(a)).scale(240);
      const brightness=.24+Math.pow(random(),3)*.7,warm=random()>.78;
      const color=new Color4(warm?.94:.72,warm?.82:.83,warm?.66:1,brightness);
      starColors.push([color,color]);
      return [v,v.add(new Vector3(.014+random()*.046,0,0))];
    });
    this.stars=MeshBuilder.CreateLineSystem('distant stars',{lines:stars,colors:starColors,useVertexAlpha:true},this.scene);
    this.stars.isPickable=false;
    const coronaTexture=new DynamicTexture('solar corona',128,this.scene,false),coronaContext=coronaTexture.getContext();
    const coronaGradient=coronaContext.createRadialGradient(64,64,12,64,64,64);
    coronaGradient.addColorStop(0,'rgba(255,209,132,.3)');coronaGradient.addColorStop(.3,'rgba(255,184,91,.07)');coronaGradient.addColorStop(1,'rgba(255,165,65,0)');
    coronaContext.fillStyle=coronaGradient;coronaContext.fillRect(0,0,128,128);coronaTexture.update();
    const coronaMaterial=new StandardMaterial('soft sunlight',this.scene);coronaMaterial.diffuseTexture=coronaTexture;coronaMaterial.opacityTexture=coronaTexture;
    coronaMaterial.disableLighting=true;coronaMaterial.emissiveColor=Color3.White();coronaMaterial.disableDepthWrite=true;coronaMaterial.alphaMode=Constants.ALPHA_ADD;
    const corona=MeshBuilder.CreatePlane('sun halo',{size:18},this.scene);corona.material=coronaMaterial;corona.parent=this.sun;corona.billboardMode=Mesh.BILLBOARDMODE_ALL;corona.isPickable=false;
    const shadow=new DynamicTexture('soft ground shadow',{width:128,height:128},this.scene,false);
    const ctx=shadow.getContext();
    const gradient=ctx.createRadialGradient(64,64,0,64,64,64);
    gradient.addColorStop(0,'rgba(44,47,43,0.15)');gradient.addColorStop(0.4,'rgba(44,47,43,0.06)');
    gradient.addColorStop(1,'rgba(44,47,43,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);shadow.update();
    const groundMat=new StandardMaterial('shadow only',this.scene);
    groundMat.diffuseTexture=shadow;groundMat.opacityTexture=shadow;
    groundMat.disableLighting=true;groundMat.emissiveColor=Color3.White();groundMat.backFaceCulling=false;
    this.ground=MeshBuilder.CreatePlane('ground shadow',{size:14},this.scene);
    this.ground.rotation.x=Math.PI/2;this.ground.position.y=-5.65;this.ground.scaling.y=0.8;
    this.ground.material=groundMat;this.ground.isPickable=false;
    for(const material of SURFACE_MATERIALS) {
      const mesh=materialGrain(this.scene,material,PALETTE[material]);
      mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
      mesh.parent=this.root;
      const matrices=new Float32Array(2048*16);
      mesh.thinInstanceSetBuffer('matrix',matrices,16,false);mesh.thinInstanceCount=0;
      mesh.setEnabled(false);
      this.grainMeshes.set(material,mesh);this.grainMatrices.set(material,matrices);
    }
    this.resize=new ResizeObserver(()=>{
      this.camera.fovMode=canvas.clientWidth<canvas.clientHeight?Camera.FOVMODE_HORIZONTAL_FIXED:Camera.FOVMODE_VERTICAL_FIXED;
      engine.setHardwareScalingLevel(renderScaling(canvas.clientWidth,canvas.clientHeight,window.devicePixelRatio||1));
      engine.resize();this.sectionFitPending=true;if(this.sectionCamera.active)this.sectionCamera.frame('surface');
    });this.resize.observe(canvas);
    let sectionDrag:{id:number;x:number;y:number}|null=null;const sectionTouches=new Set<number>();
    canvas.addEventListener('pointerdown',event=>{
      this.focusFlight=null;this.axisAlignment.cancel();if(event.pointerType==='touch')sectionTouches.add(event.pointerId);
      // Two-finger navigation belongs to the common pinch/centroid handler.
      if(sectionTouches.size>1){sectionDrag=null;return;}
      if(this.sectionCamera.active&&(event.button===2||(event.button===0&&this.inspectionMode))){sectionDrag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);}
    });
    canvas.addEventListener('pointermove',event=>{if(sectionDrag?.id===event.pointerId){if(this.sectionCamera.active)this.navigateSection((event.clientX-sectionDrag.x)/220,(event.clientY-sectionDrag.y)/220,event.shiftKey);sectionDrag={id:event.pointerId,x:event.clientX,y:event.clientY};}});
    const releaseSection=(event:PointerEvent)=>{sectionTouches.delete(event.pointerId);if(sectionDrag?.id===event.pointerId)sectionDrag=null;};
    canvas.addEventListener('pointerup',releaseSection);canvas.addEventListener('pointercancel',releaseSection);canvas.addEventListener('lostpointercapture',releaseSection);
    canvas.addEventListener('wheel',event=>{if(this.sectionCamera.active){event.preventDefault();this.sectionCamera.zoom(Math.exp(event.deltaY*.001));}},{passive:false});
    updateSectionClip(this.scene,this.root,Vector3.Forward(),1e6);
    this.update(state,0);this.setSpace(true);this.setSun([-0.65,0.72,0.35]);this.scene.executeWhenReady(()=>this.readyCallback());
  }
  static async create(canvas:HTMLCanvasElement,grid:SphereGrid,state:Float32Array,renderRefinement=0) {
    let engine:AbstractEngine;
    const forceCpu=new URLSearchParams(location.search).get('cpu')==='1';
    if(!forceCpu && await WebGPUEngine.IsSupportedAsync) {
      try {
        const gpu=new WebGPUEngine(canvas,{antialias:true,powerPreference:'high-performance'});
        await gpu.initAsync();engine=gpu;
      }catch(error){
        console.warn('WebGPU renderer unavailable; using WebGL.',error);
        // A failed WebGPU canvas context cannot be reused for WebGL.
        const replacement=canvas.cloneNode() as HTMLCanvasElement;
        canvas.replaceWith(replacement);canvas=replacement;
        engine=new Engine(canvas,true,{preserveDrawingBuffer:false});
      }
    }else engine=new Engine(canvas,true,{preserveDrawingBuffer:false});
    engine.setHardwareScalingLevel(renderScaling(canvas.clientWidth,canvas.clientHeight,window.devicePixelRatio||1));
    return new PlanetView(canvas,grid,state,engine,renderRefinement);
  }
  onReady(callback:()=>void) {this.readyCallback=callback;if(this.scene.isReady())callback();}
  update(state:Float32Array,dt=0,environment?:Environment) {
    this.syncState(state,environment);
    if(this.systemScene.active)return;
    this.sectionDirty=true;
    const surface=this.surface;
    const heights=Float32Array.from({length:this.grid.count},(_,i)=>solidHeight(state,i,this.grid));
    this.displayHeights.set(heights);
    this.surfaceState.set(state);
    this.groundCover.set(vegetationCover(this.grid,state));
    this.surfaceDepths.set(shorelineDepths(this.grid,heights,
      Float32Array.from({length:this.grid.count},(_,i)=>Math.max(0,state[i*STRIDE+F.water]-Math.min(1.2,state[i*STRIDE+F.soil]*.12)))));
    for(let i=0;i<surface.count;i++) {
      const a=surface.parents[i*2],b=surface.parents[i*2+1],p=i*STRIDE;
      if(i>=this.grid.count){
        const c=surface.third[i],divisor=c>=0?3:2;
        this.groundCover[i]=(this.groundCover[a]+this.groundCover[b]+(c>=0?this.groundCover[c]:0))/divisor;
        for(let f=0;f<STRIDE;f++)this.surfaceState[p+f]=(this.surfaceState[a*STRIDE+f]+this.surfaceState[b*STRIDE+f]+(c>=0?this.surfaceState[c*STRIDE+f]:0))/divisor;
        this.displayHeights[i]=(this.displayHeights[a]+this.displayHeights[b]+(c>=0?this.displayHeights[c]:0))/divisor;
        this.surfaceDepths[i]=(this.surfaceDepths[a]+this.surfaceDepths[b]+(c>=0?this.surfaceDepths[c]:0))/divisor;
      }
    }

    softenShore(this.displayHeights,this.surfaceDepths,surface.neighbors,this.shoreHeight,this.shoreDepth);
    this.updateAtmosphere();this.biosphere.update(state,this.renderRadii,this.surfaceTime,this.groundCover);
    for(let i=0;i<surface.count;i++){
      const solid=this.displayHeights[i],radius=RADIUS+altitude(solid);
      this.sectionSamples.solidRadii[i]=radius;
      const p=i*STRIDE;this.sectionSamples.bedrockHeights![i]=this.sectionSamples.baseHeights[i]+this.surfaceState[p+F.rock];this.sectionSamples.mobileWater[i]=Math.max(0,this.surfaceState[p+F.water]-Math.min(1.2,this.surfaceState[p+F.soil]*.12));
      // Interpolate hydraulic head, not a smoothed ground plus unsmoothed stock.
      // A settled lake retains a level surface as terrain resolution increases.
      const waterRadius=RADIUS+altitude(solid+this.surfaceDepths[i])+.008;
      for(let k=0;k<3;k++) {
        const dir=surface.directions[i*3+k];
        this.vertexTerrain[i*3+k]=dir*radius;this.vertexWater[i*3+k]=dir*waterRadius;
      }
    }
    this.waterData.fill(0);this.waterNormals.fill(0);
    VertexData.ComputeNormals(this.vertexTerrain,surface.indices,this.surfaceNormals);
    const fields=[F.sand,F.clay,F.ceramic,F.glass,F.salt,F.molten,F.soil,F.iron,F.ice];
    const palette=[PALETTE.sand,PALETTE.clay,PALETTE.ceramic,PALETTE.glass,PALETTE.salt,PALETTE.molten,PALETTE.soil,PALETTE.iron,PALETTE.ice];
    const bankPositions:number[]=[],bankIndices:number[]=[],bankColors:number[]=[],bankSurface:number[]=[];
    const indices=[0,0,0];
    for(let p=0;p<surface.indices.length;p+=3) {
      indices[0]=surface.indices[p];indices[1]=surface.indices[p+1];indices[2]=surface.indices[p+2];
      const owner=surface.owners[p/3],normalOffset=owner*3;
      const nx=this.surfaceNormals[normalOffset],ny=this.surfaceNormals[normalOffset+1],nz=this.surfaceNormals[normalOffset+2];
      const facet=1;
      const inset=this.hexagonalSurface&&this.surfaceDepths[owner]>=.035?.045:0;
      for(let k=0;k<3;k++) {
        const vertex=indices[k];
        for(let c=0;c<3;c++){
          this.terrainData[(p+k)*3+c]=this.vertexTerrain[vertex*3+c]-surface.directions[vertex*3+c]*inset;
          this.normals[(p+k)*3+c]=this.hexagonalSurface?[nx,ny,nz][c]:[nx,ny,nz][c]*.12+this.surfaceNormals[vertex*3+c]*.88;
          const hotSurface=this.surfaceDepths[vertex]>.035?this.vertexWater:this.vertexTerrain;
          this.heatPositions[(p+k)*3+c]=hotSurface[vertex*3+c]*1.002;
        }
        const materialVertex=this.hexagonalSurface?owner:vertex;
        const rgba=(p+k)*4,cell=materialVertex*STRIDE;
        // Continuous vertex weights remove triangle-by-triangle material popping.
        let total=.35,cr=PALETTE.rock[0]*.35,cg=PALETTE.rock[1]*.35,cb=PALETTE.rock[2]*.35;
        for(let f=0;f<fields.length;f++){const weight=Math.min(8,this.surfaceState[cell+fields[f]]);total+=weight;cr+=palette[f][0]*weight;cg+=palette[f][1]*weight;cb+=palette[f][2]*weight;}
        const plant=this.groundCover[materialVertex],wet=1-Math.exp(-this.surfaceState[cell+F.water]*2);
        this.colors[rgba]=cr/total*facet;
        this.colors[rgba+1]=cg/total*facet;
        this.colors[rgba+2]=cb/total*facet;
        this.surfaceInfo[rgba]=Math.min(8,this.surfaceState[cell+F.sand])/total;this.surfaceInfo[rgba+1]=Math.min(8,this.surfaceState[cell+F.clay])/total;this.surfaceInfo[rgba+2]=plant;this.surfaceInfo[rgba+3]=wet;
        this.colors[rgba+3]=Math.min(.65,this.surfaceState[cell+F.glass]/total*.5+this.surfaceState[cell+F.iron]/total*.3);
        const temperature=this.surfaceState[vertex*STRIDE+F.temperature];
        const hot=Math.pow(Math.max(0,Math.min(.9,(temperature-45)/900)),.65),cold=Math.max(0,Math.min(.16,(-temperature-1)/100));
        this.heatColors[rgba]=temperature>45?1:.14;this.heatColors[rgba+1]=temperature>45?.16+hot*.55:.55;this.heatColors[rgba+2]=temperature>45?.025:1;this.heatColors[rgba+3]=temperature>45?hot:0;
      }
      if(this.facetedSurface){
        // Material ownership belongs to this triangular face, just like its
        // flat normal. All three corners carry the same mineral and plant mix.
        for(const buffer of [this.colors,this.surfaceInfo])for(let component=0;component<4;component++){
          const average=(buffer[p*4+component]+buffer[(p+1)*4+component]+buffer[(p+2)*4+component])/3;
          for(let k=0;k<3;k++)buffer[(p+k)*4+component]=average;
        }
      }
      const wet=indices.map(v=>({x:this.vertexWater[v*3],y:this.vertexWater[v*3+1],z:this.vertexWater[v*3+2],depth:this.surfaceDepths[this.hexagonalSurface?owner:v],ice:this.surfaceState[(this.hexagonalSurface?owner:v)*STRIDE+F.ice]/Math.max(.001,this.surfaceState[(this.hexagonalSurface?owner:v)*STRIDE+F.ice]+this.surfaceState[(this.hexagonalSurface?owner:v)*STRIDE+F.water])}));
      const polygon=this.facetedSurface?facetWater(wet,indices.map(v=>Math.hypot(this.vertexTerrain[v*3],this.vertexTerrain[v*3+1],this.vertexTerrain[v*3+2]))):clipWater(wet);
      if(inset>0)for(const vertex of polygon){
        const radius=Math.hypot(vertex.x,vertex.y,vertex.z),scale=(radius-inset)/radius;
        vertex.x*=scale;vertex.y*=scale;vertex.z*=scale;
      }
      // The two outer fan vertices identify the adjacent dual cell. Mark only
      // water/land edges, never the internal spokes or water/water tile seams.
      let coastEdge=false;
      if(this.hexagonalSurface&&polygon.length>=3){
        const a=indices[1],b=indices[2];
        const adjacent=[surface.parents[a*2],surface.parents[a*2+1],surface.third[a]].find(cell=>cell!==owner&&(cell===surface.parents[b*2]||cell===surface.parents[b*2+1]||cell===surface.third[b]));
        coastEdge=adjacent!==undefined&&this.surfaceDepths[adjacent]<.035;
        if(coastEdge){
          const topA=Vector3.FromArray(this.vertexTerrain,a*3),topB=Vector3.FromArray(this.vertexTerrain,b*3);
          const bottomA=topA.subtract(Vector3.FromArray(surface.directions,a*3).scale(inset));
          const bottomB=topB.subtract(Vector3.FromArray(surface.directions,b*3).scale(inset));
          const start=bankPositions.length/3;
          for(const point of [topA,topB,bottomA,bottomB]){bankPositions.push(point.x,point.y,point.z);bankColors.push(.66,.54,.35,0);bankSurface.push(-1,0,0,.12);}
          const normal=Vector3.Cross(topB.subtract(topA),bottomA.subtract(topA));
          const inward=Vector3.FromArray(this.vertexTerrain,owner*3).subtract(topA);
          const order=Vector3.Dot(normal,inward)>0?[0,2,1,1,2,3]:[0,1,2,1,3,2];
          bankIndices.push(...order.map(i=>start+i));
        }
      }
      if(polygon.length>=3)this.writeWater(p*2,[polygon[0],polygon[1],polygon[2]],this.hexagonalSurface?surface.directions.subarray(owner*3,owner*3+3):undefined,coastEdge);
      if(polygon.length===4)this.writeWater(p*2+3,[polygon[0],polygon[2],polygon[3]]);

    }
    this.hexBanks.setEnabled(bankIndices.length>0);
    if(bankIndices.length){
      const data=new VertexData(),normals:number[]=[];
      VertexData.ComputeNormals(bankPositions,bankIndices,normals);
      data.positions=bankPositions;data.indices=bankIndices;data.normals=normals;data.colors=bankColors;
      data.applyToMesh(this.hexBanks,true);this.hexBanks.setVerticesData('surfaceInfo',bankSurface,true,4);
    }
    this.terrain.updateVerticesData(VertexBuffer.PositionKind,this.terrainData,true);
    this.terrain.updateVerticesData(VertexBuffer.NormalKind,this.normals);
    this.terrain.updateVerticesData(VertexBuffer.ColorKind,this.colors);
    this.terrain.updateVerticesData('surfaceInfo',this.surfaceInfo);
    
    
    
    
    this.water.updateVerticesData(VertexBuffer.PositionKind,this.waterData,true);
    this.water.updateVerticesData(VertexBuffer.NormalKind,this.waterNormals);
    this.water.updateVerticesData(VertexBuffer.ColorKind,this.waterColors);
    this.heatSurface.updateVerticesData(VertexBuffer.PositionKind,this.heatPositions,true);
    this.heatSurface.updateVerticesData(VertexBuffer.ColorKind,this.heatColors);
    this.precipitationLayer.updateSurface(this.heatPositions);
    this.cellBrush.update(this.heatPositions);this.selectionBrush.update(this.heatPositions);
    for(let i=0;i<this.grid.count;i++) {
      const p=i*STRIDE;
      if(state[p+F.temperature]>28) {
        const radius=RADIUS+altitude(this.displayHeights[i]+state[p+F.water])+.03,point=Vector3.FromArray(this.grid.directions,i*3).scale(radius);
        const evaporated=Math.min(Math.max(0,state[p+F.vapor]-this.previousVapor[i]),Math.max(0,this.previousLiquid[i]-state[p+F.water]));
        this.effects.steam(point,evaporated);
        if(dt>0)this.effects.heat(point,state[p+F.temperature],dt);
      }
      this.previousVapor[i]=state[p+F.vapor];this.previousLiquid[i]=state[p+F.water];
    }
    this.updateClimate();
  }
  syncState(state:Float32Array,environment?:Environment){
    this.state=state;if(environment)this.environment={...environment};
  }
  private writeWater(offset:number,triangle:WetVertex[],tileNormal?:Float32Array,coastEdge=false) {
    for(let i=0;i<3;i++) {
      const v=triangle[i],r=Math.hypot(v.x,v.y,v.z),p=(offset+i)*3,c=(offset+i)*4;
      this.waterData.set([v.x,v.y,v.z],p);this.waterNormals.set(tileNormal??[v.x/r,v.y/r,v.z/r],p);
      this.waterColors.set([v.ice??0,coastEdge&&i>0?1:0,0,v.depth],c);
    }
  }
  pick(x:number,y:number) {
    if(this.selectionArc&&this.sectionCamera.active&&this.sectionCamera.amount<.999)return null;
    if(this.sectionCamera.amount>.5)return this.pickSection(x,y);
    const result=this.scene.pick(x,y,mesh=>mesh===this.terrain||mesh===this.water);
    if(!result?.hit||!result.pickedPoint)return null;
    const point=Vector3.TransformCoordinates(result.pickedPoint,this.root.getWorldMatrix().clone().invert()).normalize();
    let index=0,dot=-2;
    for(let i=0;i<this.grid.count;i++) {
      const v=point.x*this.grid.directions[i*3]+point.y*this.grid.directions[i*3+1]+point.z*this.grid.directions[i*3+2];
      if(v>dot){dot=v;index=i;}
    }
    if(this.hexagonalSurface&&result.faceId>=0){
      const face=result.pickedMesh===this.water?Math.floor(result.faceId/2):result.faceId,owner=this.surface.owners[face];
      if(owner!==undefined)index=nearestCell(this.grid,this.surface.directions[owner*3],this.surface.directions[owner*3+1],this.surface.directions[owner*3+2]);
    }
    return {index,direction:[point.x,point.y,point.z],inAir:false,emitter:undefined as number[]|undefined};
  }
  private pickSection(x:number,y:number){
    if(this.sectionProjection.amount>.999)return this.pickFlatSection(x,y);
    const inverse=this.root.computeWorldMatrix(true).clone().invert(),normal=this.sectionCamera.normal,width=this.sectionCamera.clipWidth;
    const hits=this.scene.multiPick(x,y,mesh=>mesh===this.terrain||mesh===this.water||mesh===this.sectionView.mesh)??[];let coreDistance=Infinity;
    // Coincident cap triangles can otherwise choose the fixed fan at a shared edge.
    const editable=this.scene.pick(x,y,mesh=>mesh===this.sectionView.mesh,false,this.camera,(_a,_b,_c,_ray,i0)=>this.sectionView.owner(Math.floor(i0/3))>=0);
    if(editable?.hit)hits.push(editable);
    for(const hit of hits.sort((a,b)=>a.distance-b.distance)){
      if(!hit.pickedPoint)continue;const point=Vector3.TransformCoordinates(hit.pickedPoint,inverse);
      if(Math.abs(Vector3.Dot(point,normal))>width+.001)continue;
      const index=hit.pickedMesh===this.sectionView.mesh?this.sectionView.owner(hit.faceId):nearestCell(this.grid,point.x,point.y,point.z);
      if(index<0){coreDistance=Math.min(coreDistance,hit.distance);continue;}
      if(hit.distance>coreDistance+.002)return null;
      return {index,direction:[...this.grid.directions.slice(index*3,index*3+3)],inAir:false,emitter:undefined as number[]|undefined};
    }
    if(Number.isFinite(coreDistance))return null;
    const ray=this.scene.createPickingRay(x,y,Matrix.Identity(),this.camera),origin=Vector3.TransformCoordinates(ray.origin,inverse),direction=Vector3.TransformNormal(ray.direction,inverse),denominator=Vector3.Dot(normal,direction);
    if(Math.abs(denominator)<1e-8)return null;const distance=-Vector3.Dot(normal,origin)/denominator;if(distance<=0)return null;
    const point=origin.add(direction.scale(distance)),radius=point.length();if(radius<.01||radius>10)return null;
    const index=nearestCell(this.grid,point.x,point.y,point.z);
    if(radius<this.renderRadii[index])return null;
    return {index,direction:[...this.grid.directions.slice(index*3,index*3+3)],inAir:true,emitter:point.asArray()};
  }
  private pickFlatSection(x:number,y:number){
    const projection=this.sectionProjection,world=this.root.computeWorldMatrix(true),inverse=world.clone().invert(),normal=this.sectionCamera.normal,width=this.sectionCamera.clipWidth;
    const ray=this.scene.createPickingRay(x,y,Matrix.Identity(),this.camera),origin=Vector3.TransformCoordinates(ray.origin,inverse),direction=Vector3.TransformNormal(ray.direction,inverse),denominator=Vector3.Dot(normal,direction);
    if(Math.abs(denominator)<1e-8)return null;const distance=-Vector3.Dot(normal,origin)/denominator;if(distance<=0)return null;
    const flat=origin.add(direction.scale(distance));if(Math.abs(Vector3.Dot(flat,projection.u))>RADIUS*projection.halfRange||Vector3.Dot(flat,projection.v)<RADIUS)return null;
    const point=projection.backward(flat);if(point.length()>10)return null;
    // Match the rendered straight triangles exactly; inverse-transforming a
    // point alone would differ from their interpolated edges on thin layers.
    const owner=this.sectionView.pickFlat(new Ray(flat.subtract(normal.scale(width+.01)),normal,width*2+.02));
    if(owner>=0)return {index:owner,direction:[...this.grid.directions.slice(owner*3,owner*3+3)],inAir:false,emitter:undefined as number[]|undefined};
    const index=this.selectionArc?this.sectionView.columnOwner(Vector3.Dot(flat,projection.u)):nearestCell(this.grid,point.x,point.y,point.z);if(index<0||point.length()<this.renderRadii[index]-.015)return null;
    return {index,direction:[...this.grid.directions.slice(index*3,index*3+3)],inAir:true,emitter:point.asArray()};
  }
  orbitMode(enabled:boolean) {
    this.inspectionMode=enabled;
    const pointers=this.camera.inputs.attached.pointers;
    if(pointers && 'buttons' in pointers)(pointers as {buttons:number[]}).buttons=enabled?[0,2]:[2];
  }
  observationPosition(index:number){
    const direction=Vector3.FromArray(this.grid.directions,index*3);
    const radius=Math.max(Vector3.FromArray(this.vertexTerrain,index*3).length(),Vector3.FromArray(this.vertexWater,index*3).length())+.03;
    const world=this.root.getWorldMatrix();
    const physicalPoint=Vector3.TransformCoordinates(direction.scale(radius),world),point=this.sectionProjection.displayWorld(physicalPoint);
    const normal=Vector3.TransformNormal(direction,world).normalize();
    const projected=Vector3.Project(point,Matrix.Identity(),this.scene.getTransformMatrix(),new Viewport(0,0,this.canvas.clientWidth,this.canvas.clientHeight));
    const facing=this.sectionCamera.active?Math.abs(Vector3.Dot(direction.scale(radius),this.sectionCamera.normal))<=this.sectionCamera.clipWidth&&(this.sectionProjection.amount<.999||this.sectionProjection.contains(direction.scale(radius))):Vector3.Dot(normal,this.camera.globalPosition.subtract(point))>0;
    const visible=projected.z>=0&&projected.z<=1&&projected.x>=0&&projected.x<=this.canvas.clientWidth&&projected.y>=0&&projected.y<=this.canvas.clientHeight&&facing;
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight,cameraPoint=Vector3.TransformCoordinates(point,this.scene.getViewMatrix());
    const marker=visible?{x:projected.x,y:projected.y}:sceneMarker(cameraPoint.z>0?projected.x:width/2+cameraPoint.x,cameraPoint.z>0?projected.y:height/2-cameraPoint.y,false,width,height,36);
    return {...marker,visible,behindSurface:!facing&&!this.sectionCamera.active,angle:Math.atan2(marker.y-height/2,marker.x-width/2)*180/Math.PI};
  }
  sunPosition(){
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
    const cameraPoint=Vector3.TransformCoordinates(this.sun.position,this.scene.getViewMatrix());
    const projected=Vector3.Project(this.sun.position,Matrix.Identity(),this.scene.getTransformMatrix(),new Viewport(0,0,width,height));
    const marker=sceneMarker(cameraPoint.z>0?projected.x:width/2+cameraPoint.x,cameraPoint.z>0?projected.y:height/2-cameraPoint.y,cameraPoint.z>0,width,height);
    // Frustum visibility includes a partially visible sun and ignores planet occlusion.
    this.sun.computeWorldMatrix(true);
    return {...marker,onScreen:this.sun.isInFrustum(this.scene.frustumPlanes)};
  }
  focusObservation(index:number){
    if(this.systemScene.active)return;
    this.axisAlignment.cancel();
    if(this.sectionCamera.active){this.setSection(false);this.sectionCamera.update(1);this.updateSection(0);}
    this.camera.inertialAlphaOffset=0;this.camera.inertialBetaOffset=0;this.camera.inertialRadiusOffset=0;
    this.focusFlight={cell:index,time:0,alpha:this.camera.alpha,beta:this.camera.beta};
  }
  home() {
    this.focusFlight=null;
    if(this.sectionCamera.active){this.sectionFitPending=true;this.sectionCamera.home();this.onSectionChange?.();return;}
    this.axisAlignment.reset();
    this.camera.inertialAlphaOffset=0;this.camera.inertialBetaOffset=0;this.camera.inertialRadiusOffset=0;
    this.camera.alpha=-1.01;this.camera.beta=1.17;this.camera.radius=Math.min(24,Math.max(16.4,this.atmosphereRadii[0]/Math.sin(this.camera.fov/2)*1.04));
    this.onSectionChange?.();
  }
  alignSpinAxis(){
    if(this.systemScene.active||this.sectionCamera.active)return;
    this.focusFlight=null;this.camera.inertialAlphaOffset=0;this.camera.inertialBetaOffset=0;
    this.axisAlignment.align(this.spinTilt);
  }
  setAxisVisible(visible:boolean){this.showSpinAxis=visible;this.spinAxis.setEnabled(visible&&!this.sectionCamera.active);}
  turn(dx:number,dy:number) {this.focusFlight=null;this.axisAlignment.cancel();if(this.sectionCamera.active){this.navigateSection(dx,dy);return;}this.camera.alpha+=dx;this.camera.beta=Math.max(0.12,Math.min(Math.PI-0.12,this.camera.beta+dy));}
  zoom(factor:number) {this.focusFlight=null;if(this.sectionCamera.active){this.sectionCamera.zoom(factor);return;}this.camera.radius=Math.max(7.1,Math.min(24,this.camera.radius*factor));}
  brushPixels(angle:number) {
    const size=this.camera.fovMode===Camera.FOVMODE_HORIZONTAL_FIXED?this.canvas.clientWidth:this.canvas.clientHeight;
    return angle*RADIUS*size/(this.camera.radius*Math.tan(this.camera.fov/2)*(this.sectionCamera.active?this.sectionCamera.viewScale:1));
  }
  sectionBrushCells(cells:readonly number[]){return this.isSection&&this.selectionArc?cells.filter(i=>this.selectionCellSet.has(i)):[...cells];}
  setBrushCells(cells:readonly number[],kind='pour'){this.cellBrush.select(cells,this.heatPositions,kind);}
  setDark(dark:boolean) {
    this.themeDark=dark;this.scene.clearColor=new Color4(...(dark?PALETTE.dark:PALETTE.paper),1);
    this.ground.setEnabled(!dark);
  }
  setSpace(black:boolean) {
    this.themeDark=black;this.scene.clearColor=new Color4(...(black?[.018,.026,.04] as const:[.97,.976,.98] as const),1);
    this.ground?.setEnabled(false);this.stars.setEnabled(black);this.effects.setSpace(black);this.sky.setSpace(black);this.weather.setSpace(black);
    this.updateAtmosphere();
  }
  setEnvironment(e:Environment) {this.environment={...e};this.updateAtmosphere();}
  private updateAtmosphere() {
    this.atmosphereInfo=atmosphereState(this.state,this.environment);
    // The geometry is a readable compression of model kilometres, not a planet at true scale.
    let surfaceRadius=0,axisRadius=RADIUS;
    for(let i=0;i<this.grid.count;i++){this.renderRadii[i]=RADIUS+altitude(this.displayHeights[i]+Math.max(0,this.surfaceDepths[i]));surfaceRadius+=this.renderRadii[i];axisRadius=Math.max(axisRadius,this.renderRadii[i]);}
    this.spinAxis.scaling.y=(axisRadius+.65)/6.5;
    surfaceRadius/=this.grid.count;
    const info=this.atmosphereInfo,heights=[info.displayHeightKm],optics=atmosphereOptics(info,this.environment);
    for(let k=0;k<this.atmosphere.length;k++) {
      this.atmosphereRadii[k]=heights[k]>0?surfaceRadius+3.2*heights[k]/(heights[k]+90):0;
      const line=this.atmosphere[k],shade=this.themeDark?1:.62;
      line.color=new Color3(optics.color[0]*shade,optics.color[1]*shade,optics.color[2]*shade);
      line.alpha=.24*Math.min(1,info.pressure/.08);
    }
    this.sky.update(this.state,this.renderRadii,info,this.environment,this.atmosphereRadii[0]);
  }
  setSpin(angle:number,_running:boolean,tiltDegrees=0) {
    this.spinTilt=tiltDegrees;
    if(this.motionDisplay)return;
    this.applySpin(angle);
  }
  setMotion(snapshot:MotionSnapshot){this.motion=snapshot;this.motionDisplay??=new OrbitDisplay(snapshot);this.spinTilt=snapshot.spin?.tilt??0;}
  private applySpin(angle:number){
    const tiltDegrees=this.spinTilt;
    const tilt=tiltDegrees*Math.PI/180;
    this.rotationFrame.update(angle);
    this.root.rotationQuaternion=Quaternion.RotationAxis(Vector3.Forward(),tilt).multiply(Quaternion.RotationAxis(Vector3.Up(),this.rotationFrame.displayAngle));
    this.spinAxis.setEnabled(this.showSpinAxis&&!this.sectionCamera.active);
    if(!this.motionDisplay)this.setSun(this.physicalSun);
  }
  setRenderSpinFrozen(frozen:boolean){if(this.selectionEditing)this.selectionSpinFrozen=frozen;else this.rotationFrame.frozen=frozen;}
  resetRenderSpin(angle:number){this.focusFlight=null;this.motion=null;this.motionDisplay=null;this.rotationFrame.reset(angle);this.axisAlignment.reset();}
  rotationStats(){return {frozen:this.rotationFrame.frozen,physicalAngle:this.motion?.spin?.angle??this.rotationFrame.physicalAngle,interpolatedAngle:this.rotationFrame.physicalAngle,displayAngle:this.rotationFrame.displayAngle,sunPosition:this.sun.position.asArray(),axisAligning:this.axisAlignment.moving,axisVisible:this.spinAxis.isEnabled(),cameraUp:this.camera.upVector.asArray(),north:Vector3.TransformNormal(Vector3.Up(),this.root.computeWorldMatrix(true)).normalize().asArray()};}
  setSun(direction:readonly number[]) {
    this.physicalSun=direction;
    const visualSun=this.rotationFrame.sun(direction,this.spinTilt);
    const dir=Vector3.FromArray(visualSun).normalize();this.keyLight.direction=dir.scale(-1);this.sky.setSun(visualSun);
    this.terrainMaterial.setVector3('sunDirection',dir);this.waterMaterial.setVector3('sunDirection',dir);
    this.sun.position.copyFrom(dir.scale((this.environment.orbitDistance??1)*30));this.sunRays.setEnabled(false);
  }
  setCloudAppearance(flat:boolean,opacity:number){this.sky.setCloudAppearance(flat,opacity);}
  setCloudStyle(style:CloudStyle){this.sky.setCloudStyle(style);}
  setSurfaceStyle(faceted:boolean,blended:boolean|number,hexagonal=false){
    faceted=faceted||hexagonal;
    const rebuild=this.facetedSurface!==faceted||this.hexagonalSurface!==hexagonal;this.facetedSurface=faceted;this.hexagonalSurface=hexagonal;
    for(const material of [this.terrainMaterial,this.waterMaterial]){material.setFloat('surfaceFaceting',faceted?1:0);material.setFloat('hexagonalSurface',hexagonal?1:0);material.setFloat('boundaryBlend',Math.max(0,Math.min(1,Number(blended))));}
    if(rebuild)this.update(this.state);
  }
  setTime(time:number){this.surfaceTime=time;this.sectionView.setTime(time);this.solar.setFloat('time',time);this.sky.setTime(time);this.waterMaterial.setFloat('surfaceTime',time);}
  setLayers(atmosphere:boolean,clouds:boolean) {this.terrainMaterial.setFloat('cloudShadow',clouds?1:0);this.waterMaterial.setFloat('cloudShadow',clouds?1:0);this.atmosphereVisible=atmosphere;this.sky.setVisible(atmosphere,clouds);this.weather.setVisible(clouds);for(const line of this.atmosphere)if(!atmosphere)line.setEnabled(false);}
  setClimate(layer:ClimateLayer,climate:WeatherClimate){this.climateState=climate;this.climateLayers.layer=layer;this.updateClimate();}
  private updateClimate(){if(!this.climateState)return;this.climateLayers.update(this.surfaceState,this.environment,this.climateState,this.heatPositions,this.heatPositions,this.surface.owners);this.sectionView.setClimateColors(this.climateLayers.layer==='none'?null:this.climateLayers.cellColors);}
  setPrecipitationLayer(visible:boolean){this.precipitationLayer.setVisible(visible);this.sectionView.showRain(visible);this.sectionDirty=true;}
  clearPrecipitation(){this.precipitationLayer.clear();this.sectionView.clearPrecipitation();this.sectionDirty=true;}
  precipitationStats(){return this.precipitationLayer.stats();}
  visualStats() {return {climate:this.climateLayers.stats(),section:{selection:this.sectionSelection,cellIds:this.sectionView.cellIds,enabled:this.sectionCamera.enabled,amount:this.sectionCamera.amount,normal:this.sectionCamera.normal.asArray(),angle:this.sectionAngle,tilt:this.sectionTilt,framing:this.sectionFraming,navigation:this.sectionNavigation,scale:this.sectionCamera.viewScale,range:this.sectionRange,flat:this.sectionProjection.amount,halfRange:this.sectionHalfRange,heightScale:this.sectionProjection.heightScale,stackDepth:this.sectionProjection.stackDepth,...this.sectionView.stats(),clip:sectionClipStats(this.scene)},precipitationLayer:this.precipitationLayer.stats(),renderTiles:this.surface.tileCount,...this.effects.stats(),...this.weather.stats(),...this.sky.stats(),grains:this.grains.length,grainsByMaterial:Object.fromEntries(SURFACE_MATERIALS.map(m=>[m,this.grains.filter(g=>g.material===m).length])),atmosphereRadii:[...this.atmosphereRadii]};}
  deposits() {return this.grains.map(g=>({index:g.index,material:g.material,amount:g.amount}));}
  emitGas(index:number,material:GasMaterial,amount:number) {
    const dir=Vector3.FromArray(this.grid.directions,index*3),radius=this.renderRadii[index];
    this.effects.gas(dir.scale(radius+.06),material,amount);
  }
  showEscape(cells:Float32Array) {
    if(this.systemScene.active)return;
    for(let i=0;i<this.grid.count;i++)for(let k=0;k<GASES.length;k++) {
      if(cells[i*4+k]<=0)continue;
      const dir=Vector3.FromArray(this.grid.directions,i*3),radius=this.renderRadii[i];
      this.effects.escape(dir.scale(radius+.12),GASES[k].id,cells[i*4+k]);
    }
  }
  showRain(precipitated:Float32Array,dt:number) {
    this.sectionView.setPrecipitation(precipitated,dt);this.sectionDirty=true;
    this.precipitationLayer.update(precipitated,dt);
    if(this.systemScene.active)return;
    for(let i=0;i<this.grid.count;i++) {
      const rain=precipitated[i*2],snow=precipitated[i*2+1];if(rain+snow<=0)continue;
      const dir=Vector3.FromArray(this.grid.directions,i*3),floor=this.renderRadii[i];
      this.weather.emit(dir,floor,rain,false,gravityMultiplier(this.environment));
      this.weather.emit(dir,floor,snow,true,gravityMultiplier(this.environment));
    }
  }
  takeEscapedGrains() {const amount=this.escapedGrains;this.escapedGrains=0;return amount;}
  emit(index:number,material:SurfaceMaterial,amount:number,land:Grain['land'],sourceDirection?:readonly number[],sourceIndex=index,emitter?:readonly number[],cellAligned=false) {
    const dir=Vector3.FromArray(this.grid.directions,index*3);
    const radius=physicalContact(this.state,index,this.grid);
    // Visible grains fall under radial gravity; their mass enters the surface at impact.
    const source=sourceDirection?Vector3.FromArray(sourceDirection):dir;
    const sourceRadius=physicalContact(this.state,sourceIndex,this.grid);
    const localUp=Math.abs(source.y)>.9?Vector3.Right():Vector3.Up();
    const tangent=localUp.subtract(source.scale(Vector3.Dot(localUp,source))).normalize();
    const offset=sourceDirection&&!cellAligned?tangent.scale(.22):Vector3.Zero();
    const position=emitter?this.unprojectDisplayPoint(Vector3.FromArray(emitter)):source.scale(sourceRadius+.55+this.physicalRandom.next()*.05).add(offset).add(new Vector3((this.physicalRandom.next()-.5)*.045,(this.physicalRandom.next()-.5)*.045,(this.physicalRandom.next()-.5)*.045));
    const destination=dir.scale(radius),lateral=destination.subtract(source.scale(sourceRadius)).subtract(offset);
    this.grains.push({index,material,amount,land,position,age:0,spin:Math.random()*5+2,
      velocity:lateral.scale(2.0).add(source.scale(-.7)),size:(material==='water'?.024:material==='clay'?.048:material==='salt'?.028:.021)*(.75+Math.random()*.5)});
    if(material==='water'&&sourceDirection) {
      const start=this.projectPhysicalPoint(source.scale(sourceRadius+.57).add(offset)),end=this.projectPhysicalPoint(source.scale(sourceRadius+.015)),control=start.subtract(tangent.scale(.15)).subtract(source.scale(.15));
      this.streamPath=Array.from({length:13},(_,i)=>{const t=i/12;return start.scale((1-t)*(1-t)).add(control.scale(2*t*(1-t))).add(end.scale(t*t));});this.streamLife=.38;
    }
  }
  clearGrains() {this.grains=[];this.escapedGrains=0;this.streamLife=0;this.stream.setEnabled(false);this.effects.clear();this.weather.clear();}
  settleGrains() {
    for(const grain of this.grains)grain.land(grain.index,grain.amount);
    this.grains=[];
  }
  async showSystem(planets:PlanetRecord[],activeId:string){
    this.cancelSectionSelection();this.focusFlight=null;
    if(this.sectionCamera.active){this.setSection(false);this.sectionCamera.update(1);this.updateSection(0);}
    this.axisAlignment.reset();
    this.precipitationLayer.setInSystem(true);
    const center=this.systemScene.rebuild(planets,activeId);this.camera.upperRadiusLimit=220;this.orbitMode(true);
    this.root.setEnabled(false);this.systemParticles=this.scene.particlesEnabled;this.scene.particlesEnabled=false;
    await this.flySystem(center,Math.max(145,...planets.map(p=>(p.snapshot.environment.orbitDistance??1)*78)),.55,-1.3,'star');
  }
  private async flySystem(target:Vector3,radius:number,beta:number,alpha:number,anchor:string){const id=++this.systemFlightId;this.canvas.setAttribute('aria-busy','true');try{await this.systemScene.fly(target,radius,beta,alpha,anchor);}finally{if(id===this.systemFlightId)this.canvas.setAttribute('aria-busy','false');}}
  async approachPlanet(id:string){await this.flySystem(this.systemScene.destination(id),18,1.17,-1.01,id);}
  leaveSystem(){if(this.systemScene.active)this.scene.particlesEnabled=this.systemParticles;this.root.setEnabled(true);this.precipitationLayer.setInSystem(false);const {alpha,beta}=this.camera;this.systemScene.clear();this.camera.setTarget(Vector3.Zero());this.camera.alpha=alpha;this.camera.beta=beta;this.camera.upperRadiusLimit=24;this.camera.radius=18;this.orbitMode(false);}
  systemLabels(){return this.systemScene.labels(this.canvas.clientWidth,this.canvas.clientHeight);}
  pickPlanet(x:number,y:number){const hit=this.scene.pick(x,y,m=>!!m.metadata?.planetId);return hit?.pickedMesh?.metadata?.planetId as string|undefined;}
  async meteor(direction:readonly number[]){
    const normal=Vector3.FromArray(direction).normalize(),cell=nearestCell(this.grid,normal.x,normal.y,normal.z),to=normal.scale(this.renderRadii[cell]),from=to.add(normal.scale(9)).add(new Vector3(-7,3,0));
    const mesh=MeshBuilder.CreateSphere('incoming meteor',{diameter:.20,segments:12},this.scene);mesh.parent=this.root;mesh.isPickable=false;
    const mat=new StandardMaterial('hot meteor',this.scene,true);mat.emissiveColor=new Color3(1,.53,.14);mesh.material=mat;
    const trail=MeshBuilder.CreateLines('meteor trail',{points:[from,from],updatable:true},this.scene);trail.color=new Color3(1,.67,.3);trail.parent=this.root;trail.isPickable=false;
    await new Promise<void>(resolve=>this.meteorFlight={mesh,trail,from,to,t:0,resolve});
  }
  animate(dt:number,speed=1) {
    if(this.systemScene.active){this.systemScene.update(dt,speed);this.sun.position.copyFrom(this.systemScene.starPosition);this.sun.scaling.setAll(Math.max(1,Math.min(3.6,1+(this.camera.radius-24)/30)));return;}
    if(this.motion&&this.motionDisplay){this.motionDisplay.update(this.motion,dt,speed);this.applySpin(this.motionDisplay.spin);this.setSun(orbitalSun(this.motionDisplay.angle));}
    this.updateSection(dt);this.updateSelectionPreview();
    this.spinAxis.setEnabled(this.showSpinAxis&&!this.sectionCamera.active);
    if(!this.sectionCamera.active)this.axisAlignment.update(dt);
    this.systemScene.update(dt);this.sun.scaling.setAll(Math.max(1,Math.min(3.6,1+(this.camera.radius-24)/30)));
    const flight=this.focusFlight;
    if(flight){
      flight.time=Math.min(1,flight.time+dt/(matchMedia('(prefers-reduced-motion: reduce)').matches?.01:.8));
      const direction=Vector3.TransformNormal(Vector3.FromArray(this.grid.directions,flight.cell*3),this.root.computeWorldMatrix(true));
      const target=orbitAngles(cameraFrameDirection(direction,this.camera.upVector).asArray(),flight.alpha),t=flight.time*flight.time*(3-2*flight.time);
      this.camera.alpha=flight.alpha+(target.alpha-flight.alpha)*t;this.camera.beta=flight.beta+(target.beta-flight.beta)*t;
      if(flight.time===1)this.focusFlight=null;
    }
    if(this.meteorFlight){const f=this.meteorFlight;f.t=Math.min(1,f.t+dt/.9);f.mesh.position=Vector3.Lerp(f.from,f.to,f.t);MeshBuilder.CreateLines('meteor trail',{points:[Vector3.Lerp(f.from,f.to,Math.max(0,f.t-.25)),f.mesh.position],instance:f.trail as LinesMesh},this.scene);if(f.t===1){f.mesh.dispose(false,true);f.trail.dispose();this.meteorFlight=null;f.resolve();}}

    this.sky.animate(dt);this.weather.animate(dt);
    this.streamLife=Math.max(0,this.streamLife-dt);
    this.stream.setEnabled(this.streamLife>0&&!!this.streamPath);
    if(this.streamPath&&this.streamLife>0)this.stream=MeshBuilder.CreateTube('continuous water stream',{path:this.streamPath,instance:this.stream},this.scene);
    const counts=Object.fromEntries(SURFACE_MATERIALS.map(m=>[m,0])) as Record<SurfaceMaterial,number>;
    for(let n=this.grains.length-1;n>=0;n--) {
      const g=this.grains[n];
      const index=counts[g.material]++;
      if(index<2048) {
        const rotation=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(Vector3.Up(),g.velocity.normalizeToNew(),rotation);
        if(g.material!=='water')rotation.multiplyInPlace(Quaternion.RotationYawPitchRoll(g.age*g.spin,g.age*g.spin*.6,g.age*g.spin*.4));
        const stretch=g.material==='water'?1+Math.min(1.4,g.velocity.length()*.13):g.material==='clay'?.72:1;
        const matrix=Matrix.Compose(new Vector3(g.size,g.size*stretch,g.size),rotation,this.projectPhysicalPoint(g.position));
        matrix.copyToArray(this.grainMatrices.get(g.material)!,index*16);
      }
    }
    for(const material of SURFACE_MATERIALS) {
      const mesh=this.grainMeshes.get(material)!;
      mesh.setEnabled(counts[material]>0);
      mesh.thinInstanceCount=Math.min(2048,counts[material]);if(counts[material]>0)mesh.thinInstanceBufferUpdated('matrix');
    }
  }
  stepPhysics(dt:number){this.escapedGrains+=advanceFalling(this.grains,this.grid,this.state,dt,this.environment);}
  /** Preview and cap share their intersection and owner mapping; no copied simulation state. */
  beginSectionSelection(index?:number){
    if(this.sectionCamera.active){if(!this.sectionCamera.enabled){this.selectionPending=true;this.selectionPendingIndex=index;}return;}
    if(!this.selectionEditing){this.selectionBefore={arc:this.selectionArc,cells:[...this.selectionCells],ends:this.selectionEndCells,range:this.selectionWindowRange};this.selectionSpinFrozen=this.rotationFrame.frozen;this.rotationFrame.frozen=true;}
    this.selectionEditing=true;this.focusFlight=null;this.axisAlignment.cancel();
    this.camera.inertialAlphaOffset=0;this.camera.inertialBetaOffset=0;this.camera.inertialRadiusOffset=0;
    if(!this.selectionArc||index!==undefined){
      const picked=this.pick(this.canvas.clientWidth/2,this.canvas.clientHeight/2),local=Vector3.TransformCoordinates(this.camera.position,this.root.computeWorldMatrix(true).clone().invert());
      const v=index!==undefined?Vector3.FromArray(this.grid.directions,index*3):picked?Vector3.FromArray(picked.direction):local.normalize();
      const right=Vector3.TransformNormal(Vector3.TransformNormal(Vector3.Right(),this.camera.getViewMatrix().clone().invert()),this.root.computeWorldMatrix(true).clone().invert());
      this.snapSelectionArc(arcFromBasis(right,v,this.sectionRangeCells*Math.sqrt(4*Math.PI/this.grid.count)/2));
    }
    this.cellBrush.select([],this.heatPositions,'pour');this.updateSelectionPreview();this.onSectionChange?.();
  }
  private snapSelectionArc(arc:SectionArc){
    const a=nearestCell(this.grid,arc.a.x,arc.a.y,arc.a.z),requested=nearestCell(this.grid,arc.b.x,arc.b.y,arc.b.z),b=snapSectionEndpoint(this.grid,a,requested);
    this.selectionEndCells={a,b};this.selectionArc=arcFromCells(this.grid,a,b,arc);this.refreshSelectionCells();
  }
  moveSectionEndpoint(end:'a'|'b',direction:readonly number[]){this.moveSectionEndpointCell(end,nearestCell(this.grid,direction[0],direction[1],direction[2]));}
  moveSectionEndpointCell(end:'a'|'b',requested:number){
    const ends=this.selectionEndCells;if(!this.selectionEditing||!ends||!Number.isInteger(requested)||requested<0||requested>=this.grid.count)return;
    const anchor=ends[end==='a'?'b':'a'];if(requested===anchor)return;
    const cell=snapSectionEndpoint(this.grid,anchor,requested);if(cell===ends[end])return;
    this.selectionEndCells={...ends,[end]:cell};const {a,b}=this.selectionEndCells;
    this.selectionArc=arcFromCells(this.grid,a,b,this.selectionArc??undefined);
    this.refreshSelectionCells();this.updateSelectionPreview();this.onSectionChange?.();
  }
  stepSectionEndpoint(end:'a'|'b',dx:number,dy:number,steps=1){
    for(let step=0;step<steps;step++){
      const ends=this.selectionEndCells,p=this.sectionEndpointPosition(end);if(!ends||!p)return;
      let best=ends[end],score=.25;
      for(let k=0;k<NEIGHBORS;k++){const neighbor=this.grid.neighbors[ends[end]*NEIGHBORS+k];if(neighbor===INVALID||neighbor===ends[end==='a'?'b':'a']||snapSectionEndpoint(this.grid,ends[end==='a'?'b':'a'],neighbor)!==neighbor)continue;
        const q=this.observationPosition(neighbor),x=q.x-p.x,y=q.y-p.y,length=Math.hypot(x,y);if(!q.visible||length<.1)continue;const alignment=(x*dx+y*dy)/length;if(alignment>score){score=alignment;best=neighbor;}}
      if(best===ends[end])return;this.moveSectionEndpointCell(end,best);
    }
  }
  cancelSectionSelection(){
    this.selectionPending=false;if(!this.selectionEditing)return;
    this.selectionArc=this.selectionBefore?.arc??null;this.selectionCells=this.selectionBefore?.cells??[];this.selectionEndCells=this.selectionBefore?.ends??null;this.selectionWindowRange=this.selectionBefore?.range??0;this.selectionCellSet=new Set(this.selectionCells);
    this.finishSelectionEditing();this.updateSelectionPreview();this.onSectionChange?.();
  }
  private finishSelectionEditing(){if(this.selectionEditing)this.rotationFrame.frozen=this.selectionSpinFrozen;this.selectionEditing=false;this.selectionBefore=null;}
  clearSectionSelection(){this.selectionPending=false;this.finishSelectionEditing();this.selectionArc=null;this.selectionControlBasis=null;this.selectionEndCells=null;this.selectionWindowRange=0;this.selectionCells=[];this.selectionCellSet.clear();this.updateSelectionPreview();this.onSectionChange?.();}
  private refreshSelectionCells(){
    const arc=this.selectionArc;if(!arc)return;
    const cap=buildSectionMesh(this.terrainData,this.waterData,this.surface.owners,this.surfaceState,this.grid,arc.normal,this.sectionCamera.halfWidth,undefined,1/30,this.sectionSamples,true,arc);
    this.selectionCells=[...new Set(cap.owners.filter(i=>i>=0))].sort((a,b)=>{const angle=(i:number)=>{const d=Vector3.FromArray(this.grid.directions,i*3);return Math.atan2(Vector3.Dot(d,arc.u),Vector3.Dot(d,arc.v));};return angle(a)-angle(b)||a-b;});
    if(this.selectionEndCells)for(const cell of [this.selectionEndCells.a,this.selectionEndCells.b])if(!this.selectionCells.includes(cell))this.selectionCells.push(cell);
    this.selectionCellSet=new Set(this.selectionCells);
    const whole=buildSectionMesh(this.terrainData,this.waterData,this.surface.owners,this.surfaceState,this.grid,arc.normal,this.sectionCamera.halfWidth,undefined,1/30,this.sectionSamples,true,{...arc,cells:this.selectionCellSet,wholeCells:true});
    this.selectionWindowRange=arc.halfRange;for(let t=0;t<whole.owners.length;t++)if(whole.owners[t]>=0)for(let k=0;k<3;k++){const p=Vector3.FromArray(whole.positions,t*9+k*3);this.selectionWindowRange=Math.max(this.selectionWindowRange,Math.abs(Math.atan2(Vector3.Dot(p,arc.u),Vector3.Dot(p,arc.v)))+1e-6);}
    this.sectionDirty=true;
  }
  private updateSelectionPreview(){
    const arc=this.selectionArc,visible=!!arc&&!this.sectionCamera.active&&!this.systemScene.active;
    this.selectionBrush.select(visible?this.selectionCells:[],this.heatPositions,'cool');
    this.selectionLine.setEnabled(visible);if(!visible||!arc)return;
    const points=Array.from({length:65},(_,i)=>{const t=arc.halfRange*(i/32-1),d=arc.v.scale(Math.cos(t)).add(arc.u.scale(Math.sin(t))),cell=nearestCell(this.grid,d.x,d.y,d.z);return d.scale(this.renderRadii[cell]+.05);});
    MeshBuilder.CreateLines('selected section arc',{points,instance:this.selectionLine},this.scene);
  }
  sectionEndpointPosition(end:'a'|'b'){
    if(!this.selectionArc)return null;
    const cell=this.selectionEndCells?.[end]??nearestCell(this.grid,...this.selectionArc[end].asArray() as [number,number,number]),d=Vector3.FromArray(this.grid.directions,cell*3),world=this.root.computeWorldMatrix(true),point=Vector3.TransformCoordinates(d.scale(this.renderRadii[cell]+.05),world);
    const p=Vector3.Project(point,Matrix.Identity(),this.scene.getTransformMatrix(),new Viewport(0,0,this.canvas.clientWidth,this.canvas.clientHeight));
    const normal=Vector3.TransformNormal(d,world),visible=p.z>=0&&p.z<=1&&p.x>=0&&p.x<=this.canvas.clientWidth&&p.y>=0&&p.y<=this.canvas.clientHeight&&Vector3.Dot(normal,this.camera.globalPosition.subtract(point))>0;
    const viewport=new Viewport(0,0,this.canvas.clientWidth,this.canvas.clientHeight),outline=this.selectionBrush.boundaryPoints(cell,this.heatPositions).map(q=>Vector3.Project(Vector3.TransformCoordinates(q,world),Matrix.Identity(),this.scene.getTransformMatrix(),viewport));
    return {index:cell,x:p.x,y:p.y,visible,outline:outline.map(q=>({x:q.x,y:q.y}))};
  }
  get isSelectingSection(){return this.selectionEditing;}
  get sectionSelection(){const a=this.selectionArc;return {editing:this.selectionEditing,cells:[...this.selectionCells],endCells:this.selectionEndCells?{...this.selectionEndCells}:null,windowHalfRange:this.selectionWindowRange,a:a?.a.asArray()??null,b:a?.b.asArray()??null,halfRange:a?.halfRange??null};}
  setSection(enabled:boolean,index?:number){
    this.focusFlight=null;this.axisAlignment.cancel();
    const cell=index??this.pick(this.canvas.clientWidth/2,this.canvas.clientHeight/2)?.index??(()=>{const local=Vector3.TransformCoordinates(this.camera.position,this.root.computeWorldMatrix(true).clone().invert());return nearestCell(this.grid,local.x,local.y,local.z);})();
    if(enabled){this.selectionControlBasis=null;this.finishSelectionEditing();this.sectionFitPending=true;this.sectionCamera.setFlatRange(this.sectionHalfRange);}
    this.sectionCamera.toggle(enabled,Vector3.FromArray(this.grid.directions,cell*3),Math.max(RADIUS,this.renderRadii[cell]),enabled?this.selectionArc??undefined:undefined);this.sectionDirty=true;
    this.updateSelectionPreview();this.onSectionChange?.();
  }
  private restoreSelectionControls(){if(this.selectionArc&&this.selectionControlBasis){this.sectionCamera.u.copyFrom(this.selectionControlBasis.u);this.sectionCamera.v.copyFrom(this.selectionControlBasis.v);this.sectionCamera.normal.copyFrom(this.selectionControlBasis.normal);}}
  private syncSelectionArc(){if(!this.selectionArc)return;this.selectionControlBasis=arcFromBasis(this.sectionCamera.u,this.sectionCamera.v,this.selectionControlBasis?.halfRange??this.selectionArc.halfRange);this.snapSelectionArc(this.selectionControlBasis);this.sectionCamera.u.copyFrom(this.selectionArc.u);this.sectionCamera.v.copyFrom(this.selectionArc.v);this.sectionCamera.normal.copyFrom(this.selectionArc.normal);this.sectionCamera.flatRange=this.sectionHalfRange;}
  get isSection(){return this.sectionCamera.enabled;}
  get sectionAngle(){return this.sectionCamera.angleDegrees;}
  get sectionTilt(){return this.sectionCamera.tiltDegrees;}
  private get sectionHalfRange(){return this.selectionArc?this.selectionWindowRange:Math.min(Math.PI/3,this.sectionRangeCells*Math.sqrt(4*Math.PI/this.grid.count)/2);}
  get sectionRange(){return this.selectionArc?Math.round(this.selectionArc.halfRange*2/Math.sqrt(4*Math.PI/this.grid.count)):this.sectionRangeCells;}
  get sectionMagnification(){return this.sectionMagnificationMode;}
  setSectionMagnification(scale:number){this.sectionMagnificationMode=Number.isFinite(scale)?scale>0?Math.max(1,Math.min(64,scale)):0:0;if(this.sectionMagnificationMode>0)this.sectionHeightTarget=this.sectionMagnificationMode;else this.sectionFitPending=true;this.onSectionChange?.();}
  setSectionRange(cells:number){this.selectionControlBasis=null;this.sectionRangeCells=Math.max(2,Math.min(36,Math.round(cells)));if(this.selectionArc){this.snapSelectionArc(arcFromBasis(this.sectionCamera.u,this.sectionCamera.v,this.sectionRangeCells*Math.sqrt(4*Math.PI/this.grid.count)/2));this.sectionCamera.u.copyFrom(this.selectionArc.u);this.sectionCamera.v.copyFrom(this.selectionArc.v);this.sectionCamera.normal.copyFrom(this.selectionArc.normal);}this.sectionCamera.setFlatRange(this.sectionHalfRange);this.sectionFitPending=true;this.sectionDirty=true;this.onSectionChange?.();}
  get sectionFraming(){return this.sectionCamera.framing;}
  setSectionNavigation(mode:'rotate'|'pan'){this.sectionNavigation=mode;this.onSectionChange?.();}
  frameSection(mode:'surface'|'whole'){this.sectionFitPending=true;this.sectionCamera.frame(mode);this.sectionDirty=true;this.onSectionChange?.();}
  private navigateSection(dx:number,dy:number,pan=false){if(pan||this.sectionNavigation==='pan')this.sectionCamera.move(dx,dy);else {this.restoreSelectionControls();this.sectionCamera.rotate(dx,dy);this.syncSelectionArc();}this.onSectionChange?.();}
  setSectionTilt(degrees:number){this.restoreSelectionControls();this.sectionCamera.setTilt(degrees);this.syncSelectionArc();this.sectionDirty=true;this.onSectionChange?.();}
  setSectionWidth(width:number){this.sectionCamera.halfWidth=Math.max(.08,Math.min(.8,width));if(this.selectionArc)this.refreshSelectionCells();this.sectionDirty=true;this.onSectionChange?.();}
  setSectionAngle(degrees:number){this.restoreSelectionControls();this.sectionCamera.setAngle(degrees);this.syncSelectionArc();this.sectionDirty=true;this.onSectionChange?.();}
  private updateSection(dt:number){
    if(this.sectionCamera.active){const direction=this.sectionCamera.v,index=nearestCell(this.grid,direction.x,direction.y,direction.z);this.sectionCamera.followSurface(Math.max(RADIUS,this.renderRadii[index]));}
    this.sectionCamera.update(dt);const active=this.sectionCamera.active;
    if(active&&!this.sectionControlsDetached){this.camera.detachControl();this.sectionControlsDetached=true;}
    if(!active&&this.sectionControlsDetached){this.camera.attachControl(this.canvas,true);this.orbitMode(this.inspectionMode);this.sectionControlsDetached=false;}
    const width=active?this.sectionCamera.clipWidth:1e6,normal=this.sectionCamera.normal;
    this.sectionProjection.configure(this.sectionCamera.u,this.sectionCamera.v,normal,this.root.computeWorldMatrix(true),this.sectionCamera.framing==='surface'?this.sectionCamera.amount*this.sectionCamera.amount*(3-2*this.sectionCamera.amount):0,this.sectionHalfRange);
    updateSectionClip(this.scene,this.root,normal,width);this.sectionMaterials.update();this.sectionView.setVisible(active);
    if(active&&(this.sectionDirty||this.sectionWidth!==width||!this.sectionNormal.equalsWithEpsilon(normal,1e-7)||!this.sectionUp.equalsWithEpsilon(this.sectionCamera.v,1e-7))){const cap=this.sectionView.update(this.terrainData,this.waterData,this.surface.owners,this.surfaceState,normal,width,this.sectionSamples,this.sectionCamera.framing==='surface',this.selectionArc?{...this.selectionArc,cells:this.selectionCellSet,wholeCells:true}:undefined);this.sectionProjection.updateFoundation(cap);this.sectionProjection.stackDepth=Math.max(.001,this.sectionView.profileDepth(this.sectionProjection));this.sectionDirty=false;this.sectionWidth=width;this.sectionNormal.copyFrom(normal);this.sectionUp.copyFrom(this.sectionCamera.v);}
    if(!active&&this.selectionPending){this.selectionPending=false;this.beginSectionSelection(this.selectionPendingIndex);}
    if(active){
      if(this.sectionFitPending&&this.sectionCamera.amount>.999&&this.sectionProjection.stackDepth>.003){if(this.sectionMagnificationMode===0)this.sectionHeightTarget=Math.max(1,Math.min(64,this.sectionCamera.profileHalfHeight*.68/Math.max(.03,this.sectionProjection.stackDepth)));this.sectionFitPending=false;}
      this.sectionProjection.heightScale+=(this.sectionHeightTarget-this.sectionProjection.heightScale)*(1-Math.exp(-dt/.12));
      this.sectionView.setPowderSize(Math.max(.003,this.sectionCamera.displayHalfHeight*2/Math.max(1,this.canvas.clientHeight)*5));
      this.sectionView.updateProjection(this.sectionProjection);
    }
  }
  private projectPhysicalPoint(point:Vector3){
    const i=nearestCell(this.grid,point.x,point.y,point.z),column=columnGeometry(this.state,i,this.grid);
    return point.normalizeToNew().scale(this.renderRadii[i]+point.length()-column.physicalContact);
  }
  private unprojectDisplayPoint(point:Vector3){const i=nearestCell(this.grid,point.x,point.y,point.z),column=columnGeometry(this.state,i,this.grid);return point.normalizeToNew().scale(column.physicalContact+point.length()-this.renderRadii[i]);}
  dispose() {this.resize.disconnect();this.scene.dispose();this.engine.dispose();}
}
