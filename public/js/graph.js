import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import * as d3 from 'd3-force-3d';

const STAR_TWINKLE_SPEED = 2.8;
const BACKGROUND_ROTATION_SPEED = 0.01;
const STAR_TWINKLE_AMPLITUDE = 0.9;
const CLOCK_START = performance.now() * 0.001;
const MAX_DUST = 400;
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const UNIT_Y = new THREE.Vector3(0, 1, 0);
const CAMERA_MOVE_SPEED = 350;
const SCROLL_SPEED = 50;
const ROTATION_SPEED = 0.002;
let sharedConeGeometry = new THREE.ConeGeometry(2, 6, 8);
const sharedMaterials = new Map();

const PI_HALF = Math.PI / 2;
const MAX_PITCH = PI_HALF - 0.1; // ~85 degrees

let stateRef;
let configRef;
let graphRef = null;
let lastFrameTime = null;
let cameraRef = null;
let showLabels = true;
let inputHandlersInitialized = false;
const textureCache = new Map();
let isDragging = false;

const transitionState = {
    active: false,
    startTime: 0,
    duration: 0,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startQuat: new THREE.Quaternion(),
    endQuat: new THREE.Quaternion()
};

const inputState = {
    keys: {
        forward: false,
        back: false,
        left: false,
        right: false,
        up: false,
        down: false
    },
    mouse: {
        isDown: false
    }
};

function isFormFieldActive() {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;

    const tagName = active.tagName ? active.tagName.toLowerCase() : '';
    const isFormField = ['input', 'textarea', 'select'].includes(tagName);

    return isFormField || active.isContentEditable;
}

function buildStarVertexShader() {
    return `
        uniform float uTime;
        attribute vec3 starColor;
        attribute float size;
        attribute float phase;
        varying vec3 vColor;
        varying float vOpacity;
        varying float vSpriteSize;
        void main() {
            vColor = starColor;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // 1. Calculate the theoretical size based on distance
            float projSize = size * (1000.0 / -mvPosition.z);

            // 2. GEOMETRIC FIX: Clamp minimum PointSize to 4.0.
            // This prevents the "core" (0.1 of diameter) from becoming sub-pixel (< 1px).
            // If the core is sub-pixel, rasterization snaps it on/off (flickering).
            // A 4.0px point results in a ~0.8px core, which is stable.
            gl_PointSize = clamp(projSize, 4.0, 28.0);
            vSpriteSize = gl_PointSize;

            gl_Position = projectionMatrix * mvPosition;

            // 3. OPACITY FIX: Adjust fade to match the new clamped geometry.
            // Since we forced geometry to 4.0, we must fade the star out using Alpha
            // before the user notices it's artificially large.
            // Range 1.8 -> 3.8:
            // - Below 1.8 theoretical pixels: Fully invisible (0.0 opacity).
            // - 1.8 to 3.8: Fades in smoothly.
            float sizeFade = smoothstep(1.8, 3.8, projSize);
            float t = 0.5 + 0.5 * sin(uTime * ${STAR_TWINKLE_SPEED} + phase);
            float eased = t * t * (3.0 - 2.0 * t);
            float sizeFactor = clamp((size - 3.0) / 24.0, 0.0, 1.0);
            float sizeEase = pow(sizeFactor, 1.05);
            float scaledAmplitude = ${STAR_TWINKLE_AMPLITUDE} * mix(0.55, 1.08, sizeEase);
            vOpacity = (0.78 + scaledAmplitude * eased) * sizeFade;
        }
    `;
}

function buildDustVertexShader() {
    return `
        uniform float uTime;
        attribute vec3 starColor;
        attribute float size;
        attribute float phase;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
            vColor = starColor;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            
            // Calculate projected size based on distance
            float projSize = size * (1000.0 / -mvPosition.z);

            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = clamp(projSize, 0.0, 28.0);
            
            float t = 0.5 + 0.5 * sin(uTime * ${STAR_TWINKLE_SPEED} + phase);
            float eased = t * t * (3.0 - 2.0 * t);
            float sizeFactor = clamp((size - 3.0) / 24.0, 0.0, 1.0);
            float sizeEase = pow(sizeFactor, 1.05);
            float scaledAmplitude = ${STAR_TWINKLE_AMPLITUDE} * mix(0.55, 1.08, sizeEase);
            
            // Opacity is purely based on twinkle for beams
            vOpacity = (0.78 + scaledAmplitude * eased);
        }
    `;
}

const STAR_FRAGMENT_SHADER = `
    varying vec3 vColor;
    varying float vOpacity;
    void main() {
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float dist = length(xy);
        float core = smoothstep(0.1, 0.0, dist);
        float halo = smoothstep(0.4, 0.0, dist) * 0.4;
        float alpha = (core + halo);
        vec3 boosted = (vColor + vec3(0.12, 0.12, 0.24) * (halo * 2.0)) * (1.12 + halo * 0.12);
        vec3 finalColor = boosted * vOpacity;
        gl_FragColor = vec4(finalColor, alpha * vOpacity);
    }
`;

const STAR_ANTI_FLICKER_FRAGMENT_SHADER = `
    varying vec3 vColor;
    varying float vOpacity;
    varying float vSpriteSize;

    void main() {
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float dist = length(xy);

        float minUvRadius = 0.75 / vSpriteSize;
        float coreRadius = max(0.1, minUvRadius);

        float core = smoothstep(coreRadius, 0.0, dist);
        float halo = smoothstep(0.4, 0.0, dist) * 0.4;
        
        float alpha = (core + halo);
        vec3 boosted = (vColor + vec3(0.12, 0.12, 0.24) * (halo * 2.0)) * (1.12 + halo * 0.12);
        vec3 finalColor = boosted * vOpacity;
        gl_FragColor = vec4(finalColor, alpha * vOpacity);
    }
`;


function resetInputState() {
    inputState.keys.forward = false;
    inputState.keys.back = false;
    inputState.keys.left = false;
    inputState.keys.right = false;
    inputState.keys.up = false;
    inputState.keys.down = false;
    inputState.mouse.isDown = false;
    isDragging = false;
}

function initInputHandlers(element) {
    if (!element || inputHandlersInitialized) return;

    // Ensure camera uses FPS-style Euler ordering
    if (cameraRef) cameraRef.rotation.order = 'YXZ';

    const updateKeyState = (code, isPressed) => {
        switch (code) {
            case 'KeyW':
                inputState.keys.forward = isPressed;
                break;
            case 'KeyS':
                inputState.keys.back = isPressed;
                break;
            case 'KeyA':
                inputState.keys.left = isPressed;
                break;
            case 'KeyD':
                inputState.keys.right = isPressed;
                break;
            case 'Space':
                inputState.keys.up = isPressed;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                inputState.keys.down = isPressed;
                break;
            default:
                break;
        }
    };

    window.addEventListener('keydown', event => {
        if (isFormFieldActive()) return;
        updateKeyState(event.code, true);
    });

    window.addEventListener('keyup', event => updateKeyState(event.code, false));

    element.addEventListener('mousedown', event => {
        if (event.button === 0) {
            isDragging = true;
            inputState.mouse.isDown = true;

            if (cameraRef) {
                cameraRef.rotation.order = 'YXZ';
                cameraRef.rotation.setFromQuaternion(cameraRef.quaternion, 'YXZ');
            }
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        inputState.mouse.isDown = false;
    });

    element.addEventListener('mousemove', event => {
        if (!isDragging || !cameraRef || transitionState.active) return;

        const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

        cameraRef.rotation.y -= movementX * ROTATION_SPEED;
        cameraRef.rotation.x -= movementY * ROTATION_SPEED;

        cameraRef.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cameraRef.rotation.x));
        cameraRef.rotation.z = 0;

        cameraRef.updateMatrix();
    });

    element.addEventListener('wheel', event => {
        if (!cameraRef || transitionState.active) return;
        event.preventDefault();

        const forward = new THREE.Vector3();
        cameraRef.getWorldDirection(forward);
        const distance = -Math.sign(event.deltaY) * SCROLL_SPEED;
        cameraRef.position.addScaledVector(forward, distance);
    }, { passive: false });

    inputHandlersInitialized = true;
}

function processCameraMovement(dt) {
    if (!graphRef || !cameraRef || transitionState.active) return;
    if (isFormFieldActive()) return;

    const forward = new THREE.Vector3();
    cameraRef.getWorldDirection(forward);
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, UNIT_Y).normalize();

    const moveDir = new THREE.Vector3();

    if (inputState.keys.forward) moveDir.add(forward);
    if (inputState.keys.back) moveDir.sub(forward);
    if (inputState.keys.right) moveDir.add(right);
    if (inputState.keys.left) moveDir.sub(right);
    if (inputState.keys.up) moveDir.add(UNIT_Y);
    if (inputState.keys.down) moveDir.sub(UNIT_Y);

    if (moveDir.lengthSq() > 0) {
        moveDir.normalize().multiplyScalar(CAMERA_MOVE_SPEED * dt);
        cameraRef.position.add(moveDir);
    }
}

function createClusterForce(sectorPositions, strength = 0.15) {
    let nodes = [];

    const force = (alpha) => {
        nodes.forEach(node => {
            const sectorIndex = Math.abs(node.id) % sectorPositions.length;
            const target = sectorPositions[sectorIndex];

            if (!target) return;

            node.vx += (target.x - node.x) * strength * alpha;
            node.vy += (target.y - node.y) * strength * alpha;
            node.vz += (target.z - node.z) * strength * alpha;
        });
    };

    force.initialize = (nodeArray) => {
        nodes = nodeArray || [];
    };

    return force;
}

export function createGraph({ state, config, element, onNodeClick, onLinkClick, onBackgroundClick }) {
    stateRef = state;
    configRef = config;

    const SECTOR_POSITIONS = [
        new THREE.Vector3(260, 0, -60),
        new THREE.Vector3(-180, 220, 40),
        new THREE.Vector3(-180, -220, 40)
    ];

    graphRef = ForceGraph3D({
        rendererConfig: { logarithmicDepthBuffer: true, alpha: false }
    })(element)
        .backgroundColor('#000000')
        .showNavInfo(false)
        .nodeLabel('name')
        .nodeThreeObject(nodeRenderer)
        .linkWidth(link => link === stateRef.highlightLink ? 3.5 : 1.5)
        .linkOpacity(0.6)
        .linkColor(() => 'rgba(0,0,0,0)')
        .linkDirectionalParticles(0)
        .linkThreeObjectExtend(true)
        .linkThreeObject(linkRenderer)
        .linkPositionUpdate((group, { start, end }) => {
            if (!group.userData._vStart) {
                group.userData._vStart = new THREE.Vector3();
                group.userData._vEnd = new THREE.Vector3();
                group.userData._dir = new THREE.Vector3();
                group.userData._tmp = new THREE.Vector3();
            }

            const vStart = group.userData._vStart.set(start.x, start.y, start.z);
            const vEnd = group.userData._vEnd.set(end.x, end.y, end.z);
            const dist = vStart.distanceTo(vEnd);

            group.position.set(
                start.x + (end.x - start.x) / 2,
                start.y + (end.y - start.y) / 2,
                start.z + (end.z - start.z) / 2
            );

            const dustContainer = group.children ? group.children.find(c => c.name === 'dust-container') : null;
            if (dustContainer) {
                if (dist > 0.001) {
                    const dir = group.userData._dir.copy(vEnd).sub(vStart).normalize();
                    dustContainer.quaternion.setFromUnitVectors(UNIT_Z, dir);
                    dustContainer.scale.set(1, 1, dist);
                    dustContainer.visible = true;

                    const link = group.userData.link;
                    const style = link ? configRef.relStyles[link.type] : null;
                    const hasParticles = !!(style && style.particle === true);
                    const points = dustContainer.children.find(c => c.name === 'dust-points');
                    if (hasParticles && points && points.geometry) {
                        const count = Math.min(MAX_DUST, Math.floor(dist * 1.2));
                        points.geometry.setDrawRange(0, count);
                    } else if (points) {
                        points.visible = false;
                    }
                } else {
                    dustContainer.visible = false;
                    dustContainer.scale.set(0, 0, 0);
                }
            }

            const arrow = group.children ? group.children.find(c => c.name === 'direction-cone') : null;
            const arrowRev = group.children ? group.children.find(c => c.name === 'reverse-direction-cone') : null;

            if (arrow && arrowRev) {
                const link = group.userData.link;
                const isDirected = !!(link && configRef && Array.isArray(configRef.directedTypes) && configRef.directedTypes.includes(link.type));

                if (dist > 10) {
                    const dir = group.userData._dir.copy(vEnd).sub(vStart);
                    if (dir.lengthSq() > 0) {
                        dir.normalize();
                        const offset = dist * 0.15;

                        arrow.visible = true;
                        arrow.quaternion.setFromUnitVectors(UNIT_Y, dir);
                        arrow.position.set(
                            dir.x * offset,
                            dir.y * offset,
                            dir.z * offset
                        );

                        if (!isDirected) {
                            arrowRev.visible = true;
                            const revDir = dir.clone().negate();
                            arrowRev.quaternion.setFromUnitVectors(UNIT_Y, revDir);
                            arrowRev.position.set(
                                revDir.x * offset,
                                revDir.y * offset,
                                revDir.z * offset
                            );
                        } else {
                            arrowRev.visible = false;
                        }
                    } else {
                        arrow.visible = false;
                        arrowRev.visible = false;
                    }
                } else {
                    arrow.visible = false;
                    arrowRev.visible = false;
                }
            }

        })
        .onNodeClick(onNodeClick)
        .onLinkClick(onLinkClick)
        .onBackgroundClick(onBackgroundClick)
        .onNodeDragEnd(node => {
            node.fx = node.x;
            node.fy = node.y;
            node.fz = node.z;
        });

    // ---------------------------------------------------------
    // PHYSICS TWEAKS TO FIX BUNCHING
    // ---------------------------------------------------------

    // 1. Increase Repulsion (Charge)
    // Default is usually around -30. Making it more negative (-150)
    // pushes nodes apart more aggressively, expanding the whole cluster.
    graphRef.d3Force('charge').strength(-220);

    // 2. Increase Link Distance
    // Default is usually around 30. Increasing this (e.g., to 80 or 100)
    // makes the "strings" connecting nodes longer.
    graphRef.d3Force('link').distance(130);

    graphRef.d3Force('cluster', createClusterForce(SECTOR_POSITIONS, 0.16));
    graphRef.d3Force('collide', d3.forceCollide(15));

    // ---------------------------------------------------------

    const renderer = graphRef.renderer && graphRef.renderer();
    if (renderer) {
        renderer.useLegacyLights = false;
        renderer.toneMapping = THREE.LinearToneMapping;
        renderer.toneMappingExposure = 0.9;
    }

    const composer = graphRef.postProcessingComposer && graphRef.postProcessingComposer();
    if (composer) {
        const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.3, 0.85);
        composer.addPass(bloom);
    }

    const controls = graphRef.controls();
    if (controls) {
        controls.enabled = false;

        if (typeof controls.dispose === 'function') {
            controls.dispose();
        }

        controls.update = () => {};
    }

    cameraRef = graphRef.camera();
    if (cameraRef) {
        cameraRef.rotation.order = 'YXZ';
        cameraRef.rotation.setFromQuaternion(cameraRef.quaternion, 'YXZ');
    }

    initInputHandlers(element);

    return graphRef;
}

export function transitionCamera(pos, lookAt, duration = 1500) {
    if (!cameraRef) return;

    resetInputState();

    transitionState.startTime = performance.now();
    transitionState.duration = duration;
    transitionState.startPos.copy(cameraRef.position);
    transitionState.endPos.set(pos.x, pos.y, pos.z);
    transitionState.startQuat.copy(cameraRef.quaternion);

    const lookTarget = new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z);
    const previewCam = cameraRef.clone();
    previewCam.position.copy(transitionState.endPos);
    previewCam.lookAt(lookTarget);
    transitionState.endQuat.copy(previewCam.quaternion);

    transitionState.active = true;
}

function easeCubicInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function updateLinkLabelVisibility() {
    const links = (stateRef && stateRef.graphData && Array.isArray(stateRef.graphData.links)) ? stateRef.graphData.links : [];

    links.forEach(link => {
        const label = link.__label || (link.__group && link.__group.children.find(c => c.name === 'link-label'));
        if (label) {
            label.visible = !link.hideLabel && showLabels;
        }
    });
}

export function animateGraph() {
    if (!graphRef || !stateRef) return;

    const now = performance.now();
    if (lastFrameTime === null) lastFrameTime = now;
    const deltaSeconds = (now - lastFrameTime) * 0.001;
    lastFrameTime = now;

    if (transitionState.active) {
        const elapsed = now - transitionState.startTime;
        const t = Math.min(1, elapsed / transitionState.duration);
        const eased = easeCubicInOut(t);

        cameraRef.position.lerpVectors(transitionState.startPos, transitionState.endPos, eased);
        cameraRef.quaternion.slerpQuaternions(transitionState.startQuat, transitionState.endQuat, eased);

        if (t >= 1) {
            transitionState.active = false;

            if (cameraRef) {
                cameraRef.rotation.setFromQuaternion(cameraRef.quaternion, 'YXZ');
            }
        }
    } else {
        processCameraMovement(deltaSeconds);
    }

    const time = Date.now() * 0.0015;
    const elapsedSeconds = (now * 0.001) - CLOCK_START;
    const opacity = 0.45 + Math.sin(time) * 0.15;
    const scaleMod = 1.0 + Math.sin(time) * 0.05;

    const links = (stateRef.graphData && stateRef.graphData.links) ? stateRef.graphData.links : [];
    links.forEach(link => {
        if(link.__dust) {
            link.__dust.rotation.z += 0.3 * deltaSeconds;
            if (link.__dustMat && link.__dustMat.uniforms && link.__dustMat.uniforms.uTime) {
                link.__dustMat.uniforms.uTime.value = elapsedSeconds;
            }
        }
    });

    const scene = graphRef.scene();
    const bg = scene.getObjectByName('starfield-bg');
    if (bg) {
        bg.rotation.y = elapsedSeconds * BACKGROUND_ROTATION_SPEED;
        const stars = bg.children[0];
        if(stars && stars.material.uniforms) {
            stars.material.uniforms.uTime.value = elapsedSeconds;
        }
    }

    // Update label visibility based on proximity to the specific link
    if (cameraRef && stateRef.graphData && stateRef.graphData.links) {
        const camPos = cameraRef.position;
        const LABEL_VISIBLE_DIST = 500;

        stateRef.graphData.links.forEach(link => {
            const label = link.__label || (link.__group && link.__group.children.find(c => c.name === 'link-label'));
            if (label) {
                if (link.hideLabel) {
                    label.visible = false;
                } else {
                    const linkPos = link.__group ? link.__group.position : null;
                    if (linkPos) {
                        const dist = camPos.distanceTo(linkPos);
                        label.visible = dist < LABEL_VISIBLE_DIST;
                    }
                }
            }
        });
    }

    requestAnimationFrame(animateGraph);
}

export function initStarfieldBackground() {
    if (!graphRef) return;
    const scene = graphRef.scene();
    if (scene.getObjectByName('starfield-bg')) return;

    const group = new THREE.Group();
    group.name = 'starfield-bg';

    setTimeout(() => {
        const starCount = 3800;
        const geo = new THREE.BufferGeometry();
        const pos = [];
        const colors = [];
        const sizes = [];
        const phases = [];

        for(let i=0; i<starCount; i++) {
            const r = 2500 * Math.random() + 800;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);

            pos.push(x, y, z);

            const baseColor = new THREE.Color();
            const colorRoll = Math.random();
            const saturation = 0.7 + Math.random() * 0.3;
            const lightness = 0.38 + Math.random() * 0.24;

            if (colorRoll < 0.35) {
                baseColor.setHSL(Math.random() * 0.15, saturation, lightness);
            } else {
                baseColor.setHSL(0.55 + Math.random() * 0.2, saturation, lightness);
            }
            colors.push(baseColor.r, baseColor.g, baseColor.b);

            const rand = Math.random();
            const size = (4.0 + Math.pow(rand, 3.0) * 20.0);
            sizes.push(size);

            phases.push(Math.random() * Math.PI * 2);
        }

        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('starColor', new THREE.Float32BufferAttribute(colors, 3));
        geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geo.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }
            },
            vertexShader: buildStarVertexShader(),
            fragmentShader: STAR_ANTI_FLICKER_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending
        });

        const stars = new THREE.Points(geo, mat);
        group.add(stars);

        scene.add(group);
    }, 1000);
}

function createSpaceDust(color) {
    const particleCount = 400;
    const geo = new THREE.BufferGeometry();
    const pos = [];
    const colors = [];
    const sizes = [];
    const phases = [];

    const base = new THREE.Color(color);

    for(let i=0; i<particleCount; i++) {
        const r = 3 * Math.sqrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const z = (Math.random() - 0.5);

        pos.push(x, y, z);

        const c = base.clone();
        const hsl = {};
        c.getHSL(hsl);
        hsl.s = Math.min(1.0, hsl.s * (1.05 + Math.random() * 0.35));
        hsl.l = Math.min(1.0, hsl.l * (0.98 + Math.random() * 0.18));
        const varied = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
        colors.push(varied.r, varied.g, varied.b);

        const rand = Math.random();
        const sizeBias = Math.pow(rand, 1.8);
        sizes.push(1.0 + sizeBias * 3.0);

        phases.push(Math.random() * Math.PI * 2);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('starColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geo.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 }
        },
        vertexShader: buildDustVertexShader(),
        fragmentShader: STAR_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    points.name = 'dust-points';

    return points;
}

function nodeRenderer(node) {
    const cacheKey = `${node.avatar}|${node.id === stateRef.userId ? 'self' : 'other'}|${node.name || ''}`;
    if (!textureCache.has(cacheKey)) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);

        const draw = (img = null) => {
            ctx.clearRect(0,0,size,size);

            const avatarRadius = size * 0.28;
            const avatarY = size * 0.45;

            if (node.id === stateRef.userId) {
                const glowRadius = avatarRadius * 1.8;
                const glow = ctx.createRadialGradient(size / 2, avatarY, avatarRadius * 0.25, size / 2, avatarY, glowRadius);
                glow.addColorStop(0, 'rgba(139, 92, 246, 0.45)');
                glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(size / 2, avatarY, glowRadius, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(size / 2, avatarY, avatarRadius, 0, 2 * Math.PI);
            ctx.clip();

            if(img) {
                ctx.drawImage(img, size / 2 - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
            } else {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(size / 2 - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
                ctx.fillStyle = 'white';
                ctx.font = 'bold 220px "Noto Sans SC", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((node.name || '').charAt(0).toUpperCase(), size / 2, avatarY);
            }
            ctx.restore();

            const name = (node.name || '').trim();
            ctx.font = 'bold 72px "Noto Sans SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'white';
            ctx.shadowColor = 'rgba(0,0,0,0.65)';
            ctx.shadowBlur = 12;
            ctx.fillText(name, size / 2, size * 0.78, size * 0.9);
            ctx.shadowBlur = 0;

            texture.needsUpdate = true;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
        };

        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => draw(img);
        img.onerror = () => draw(null);
        img.src = node.avatar;

        draw(null);

        textureCache.set(cacheKey, texture);
    }

    const texture = textureCache.get(cacheKey);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    material.depthWrite = false;
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(18, 18, 1);
    sprite.renderOrder = 10;

    node.dispose = () => {
        if(material) material.dispose();
    };

    return sprite;
}

function linkRenderer(link) {
    const group = new THREE.Group();
    group.userData.link = link;
    link.__group = group;
    const style = configRef.relStyles[link.type];

    if (style && style.particle) {
        const dust = createSpaceDust(style.color);

        const dustContainer = new THREE.Group();
        dustContainer.name = 'dust-container';
        dustContainer.add(dust);
        group.add(dustContainer);

        link.__dust = dust;
        link.__dustMat = dust.material;
    }

    const color = style ? style.color : '#fff';
    const mat = getSharedConeMaterial(color);
    const cone = new THREE.Mesh(getSharedConeGeometry(), mat);
    cone.name = 'direction-cone';
    cone.visible = false;
    group.add(cone);

    const cone2 = new THREE.Mesh(getSharedConeGeometry(), mat);
    cone2.name = 'reverse-direction-cone';
    cone2.visible = false;
    group.add(cone2);

    const labelText = link.displayLabel || (style ? style.label : link.type);
    const sprite = new window.SpriteText(labelText);
    sprite.color = style ? style.color : 'lightgrey';
    sprite.textHeight = 6.5;
    sprite.fontFace = '"Noto Sans SC", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif';
    sprite.name = 'link-label';
    sprite.visible = link.hideLabel ? false : showLabels;
    sprite.renderOrder = 2;
    group.add(sprite);

    link.__label = sprite;

    return group;
}

function getSharedConeMaterial(color) {
    if (!sharedMaterials.has(color)) {
        sharedMaterials.set(color, new THREE.MeshBasicMaterial({ color }));
    }

    return sharedMaterials.get(color);
}

function getSharedConeGeometry() {
    if (!sharedConeGeometry) {
        sharedConeGeometry = new THREE.ConeGeometry(2, 6, 8);
    }

    return sharedConeGeometry;
}

export function getGraph() {
    return graphRef;
}

export function destroyGraph() {
    resetInputState();
    cameraRef = null;
    graphRef = null;
    stateRef = null;
    configRef = null;
    lastFrameTime = null;
    disposeSharedConeResources();
}

export function disposeLinkVisual(link) {
    if (!link || !link.__group) return;

    const group = link.__group;
    const disposeMaterial = (mat) => {
        if (!mat) return;
        if (mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
        if (typeof mat.dispose === 'function') mat.dispose();
    };

    if (link.__dust) {
        if (link.__dust.geometry && typeof link.__dust.geometry.dispose === 'function') {
            link.__dust.geometry.dispose();
        }
        disposeMaterial(link.__dust.material);
        if (link.__dust.parent) {
            link.__dust.parent.remove(link.__dust);
        }
        delete link.__dust;
    }

    if (link.__dustMat) {
        disposeMaterial(link.__dustMat);
        delete link.__dustMat;
    }

    group.children.slice().forEach(child => {
        if (child.name === 'direction-cone' || child.name === 'reverse-direction-cone') {
            if (child.parent) {
                child.parent.remove(child);
            }
            return;
        }

        if (child.geometry && typeof child.geometry.dispose === 'function') {
            child.geometry.dispose();
        }
        if (child.material) {
            disposeMaterial(child.material);
        }
    });

    if (group.parent) {
        group.parent.remove(group);
    }

    delete link.__group;
}

function disposeSharedConeResources() {
    if (sharedConeGeometry && typeof sharedConeGeometry.dispose === 'function') {
        sharedConeGeometry.dispose();
    }
    sharedConeGeometry = null;

    sharedMaterials.forEach(mat => {
        if (!mat) return;
        if (mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
        if (typeof mat.dispose === 'function') mat.dispose();
    });
    sharedMaterials.clear();
}
