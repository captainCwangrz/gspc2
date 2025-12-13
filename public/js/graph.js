const STAR_TWINKLE_SPEED = 2.8;
const BACKGROUND_ROTATION_SPEED = 0.01;
const STAR_TWINKLE_AMPLITUDE = 0.9;
const CLOCK_START = performance.now() * 0.001;
const CAMERA_MOVE_SPEED = 360;
const MAX_DUST = 400;
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const UNIT_Y = new THREE.Vector3(0, 1, 0);

let stateRef;
let configRef;
let graphRef = null;
let lastFrameTime = null;
const textureCache = new Map();
const movementKeys = new Set(['w', 'a', 's', 'd']);
const pressedKeys = { w: false, a: false, s: false, d: false };
let removeMovementListeners = null;

function isFormFieldActive() {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;

    const tagName = active.tagName ? active.tagName.toLowerCase() : '';
    const isFormField = ['input', 'textarea', 'select', 'button'].includes(tagName);

    return isFormField || active.isContentEditable;
}

function cleanupMovementHandlers() {
    if (removeMovementListeners) {
        removeMovementListeners();
    }
}

function setupMovementHandlers() {
    if (typeof window === 'undefined') return;

    cleanupMovementHandlers();

    const onKeyDown = (event) => {
        if (isFormFieldActive()) return;
        const key = event.key ? event.key.toLowerCase() : '';
        if (movementKeys.has(key)) {
            pressedKeys[key] = true;
        }
    };

    const onKeyUp = (event) => {
        const key = event.key ? event.key.toLowerCase() : '';
        if (movementKeys.has(key)) {
            pressedKeys[key] = false;
        }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    removeMovementListeners = () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        pressedKeys.w = false;
        pressedKeys.a = false;
        pressedKeys.s = false;
        pressedKeys.d = false;
        removeMovementListeners = null;
    };
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

export function createGraph({ state, config, element, onNodeClick, onLinkClick, onBackgroundClick }) {
    stateRef = state;
    configRef = config;

    graphRef = ForceGraph3D({
        rendererConfig: { logarithmicDepthBuffer: true }
    })(element)
        .backgroundColor('#050505')
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

            group.position.set(
                start.x + (end.x - start.x) / 2,
                start.y + (end.y - start.y) / 2,
                start.z + (end.z - start.z) / 2
            );

            const dustContainer = group.children ? group.children.find(c => c.name === 'dust-container') : null;
            if (dustContainer) {
                const dist = vStart.distanceTo(vEnd);
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
            if (arrow) {
                const link = group.userData.link;
                const isDirected = !!(link && configRef && Array.isArray(configRef.directedTypes) && configRef.directedTypes.includes(link.type));
                const dist = vStart.distanceTo(vEnd);

                if (dist > 10 && isDirected) {
                    arrow.visible = true;

                    const dir = group.userData._dir.copy(vEnd).sub(vStart);
                    if (dir.lengthSq() > 0) {
                        dir.normalize();
                        arrow.quaternion.setFromUnitVectors(UNIT_Y, dir);
                        const offset = dist * 0.15;
                        arrow.position.set(
                            dir.x * offset,
                            dir.y * offset,
                            dir.z * offset
                        );
                    }
                } else {
                    arrow.visible = false;
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

    // ---------------------------------------------------------

    const renderer = graphRef.renderer && graphRef.renderer();
    if (renderer) {
        renderer.useLegacyLights = false;
    }

    const controls = graphRef.controls();
    if (controls) {
        controls.minDistance = 0;
        controls.maxDistance = 2000;
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.enablePan = true;
        controls.enableRotate = true;
        controls.enableZoom = true;
    }

    setupMovementHandlers();

    return graphRef;
}

export function animateGraph() {
    if (!graphRef || !stateRef) return;

    const now = performance.now();

    if (typeof document !== 'undefined' && document.hidden) {
        lastFrameTime = now;
        requestAnimationFrame(animateGraph);
        return;
    }

    if (lastFrameTime === null) {
        lastFrameTime = now;
    }

    const deltaSeconds = (now - lastFrameTime) * 0.001;
    lastFrameTime = now;

    const time = Date.now() * 0.0015;
    const elapsed = (now * 0.001) - CLOCK_START;
    const opacity = 0.45 + Math.sin(time) * 0.15;
    const scaleMod = 1.0 + Math.sin(time) * 0.05;

    const links = (stateRef.graphData && stateRef.graphData.links) ? stateRef.graphData.links : [];
    links.forEach(link => {
        if(link.__dust) {
            link.__dust.rotation.z += 0.005;
            if (link.__dustMat && link.__dustMat.uniforms && link.__dustMat.uniforms.uTime) {
                link.__dustMat.uniforms.uTime.value = elapsed;
            }
        }
    });

    const scene = graphRef.scene();
    const bg = scene.getObjectByName('starfield-bg');
    if (bg) {
        bg.rotation.y = elapsed * BACKGROUND_ROTATION_SPEED;
        const stars = bg.children[0];
        if(stars && stars.material.uniforms) {
            stars.material.uniforms.uTime.value = elapsed;
        }
    }

    if (graphRef) {
        const controls = graphRef.controls();
        const camera = controls && controls.object ? controls.object : null;

        if (controls && camera) {
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            const right = forward.clone().cross(camera.up);

            forward.normalize();
            if (right.lengthSq() > 0) right.normalize();

            const movement = new THREE.Vector3();
            if (pressedKeys.w) movement.add(forward);
            if (pressedKeys.s) movement.sub(forward);
            if (pressedKeys.d) movement.add(right);
            if (pressedKeys.a) movement.sub(right);

            if (movement.lengthSq() > 0 && deltaSeconds > 0) {
                movement.normalize().multiplyScalar(CAMERA_MOVE_SPEED * deltaSeconds);
                camera.position.add(movement);
                controls.target.add(movement);
            }
        }

        if (controls) {
            controls.update();
        }
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
            const lightness = 0.45 + Math.random() * 0.3;

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
    const particleCount = 2000;
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
        const size = 512;
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
                ctx.font = 'bold 220px "Orbitron", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((node.name || '').charAt(0).toUpperCase(), size / 2, avatarY);
            }
            ctx.restore();

            const name = (node.name || '').trim();
            ctx.font = 'bold 72px "Orbitron", "Noto Sans SC", sans-serif';
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
    const geo = new THREE.ConeGeometry(2, 6, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const cone = new THREE.Mesh(geo, mat);
    cone.name = 'direction-cone';
    cone.visible = false;
    group.add(cone);

    const sprite = new SpriteText(link.displayLabel || (style ? style.label : link.type));
    sprite.fontFace = '"Fredoka", "Varela Round", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    sprite.color = style ? style.color : 'lightgrey';
    sprite.textHeight = 6.5;
    sprite.fontWeight = 'bold';
    sprite.backgroundColor = 'rgba(0,0,0,0)';
    sprite.padding = 2;
    if(sprite.material) sprite.material.depthWrite = false;
    sprite.visible = link.hideLabel ? false : true;
    group.add(sprite);

    return group;
}

export function getGraph() {
    return graphRef;
}

export function destroyGraph() {
    cleanupMovementHandlers();
    graphRef = null;
    stateRef = null;
    configRef = null;
    lastFrameTime = null;
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
