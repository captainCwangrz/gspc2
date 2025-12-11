const STAR_TWINKLE_SPEED = 2.8;
const BACKGROUND_ROTATION_SPEED = 0.01;
const STAR_TWINKLE_AMPLITUDE = 0.9;
const CLOCK_START = performance.now() * 0.001;

let stateRef;
let configRef;
let graphRef = null;
const textureCache = new Map();

function buildStarVertexShader() {
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

            // Fade out very small stars to prevent aliasing flicker
            float sizeFade = smoothstep(0.3, 1.8, projSize);

            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = max(1.35, projSize);
            float t = 0.5 + 0.5 * sin(uTime * ${STAR_TWINKLE_SPEED} + phase);
            float eased = t * t * (3.0 - 2.0 * t);
            float sizeFactor = clamp((size - 3.0) / 24.0, 0.0, 1.0);
            float sizeEase = pow(sizeFactor, 1.05);
            float scaledAmplitude = ${STAR_TWINKLE_AMPLITUDE} * mix(0.55, 1.08, sizeEase);
            vOpacity = (0.78 + scaledAmplitude * eased) * sizeFade;
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
        if (alpha < 0.01) discard;
        vec3 boosted = (vColor + vec3(0.12, 0.12, 0.24) * (halo * 2.0)) * (1.12 + halo * 0.12);
        vec3 finalColor = boosted * vOpacity;
        gl_FragColor = vec4(finalColor, alpha * vOpacity);
    }
`;

export function createGraph({ state, config, element, onNodeClick, onLinkClick, onBackgroundClick }) {
    stateRef = state;
    configRef = config;

    graphRef = ForceGraph3D()(element)
        .backgroundColor('#050505')
        .showNavInfo(false)
        .nodeLabel('name')
        .nodeThreeObject(nodeRenderer)
        .linkWidth(link => link === stateRef.highlightLink ? 2 : 1)
        .linkColor(() => 'rgba(0,0,0,0)')
        .linkDirectionalParticles(0)
        .linkThreeObjectExtend(true)
        .linkThreeObject(linkRenderer)
        .linkPositionUpdate((group, { start, end }) => {
            const middlePos = Object.assign(...['x', 'y', 'z'].map(c => ({
                [c]: start[c] + (end[c] - start[c]) / 2
            })));
            Object.assign(group.position, middlePos);

            if (group.children) {
                const dustContainer = group.children.find(c => c.name === 'dust-container');
                if (dustContainer) {
                    const vStart = new THREE.Vector3(start.x, start.y, start.z);
                    const vEnd = new THREE.Vector3(end.x, end.y, end.z);
                    const dist = vStart.distanceTo(vEnd);
                    const dir = vEnd.clone().sub(vStart).normalize();

                    dustContainer.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), dir);
                    dustContainer.scale.set(1, 1, dist);
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
    graphRef.d3Force('charge').strength(-150);

    // 2. Increase Link Distance
    // Default is usually around 30. Increasing this (e.g., to 80 or 100)
    // makes the "strings" connecting nodes longer.
    graphRef.d3Force('link').distance(100);

    // ---------------------------------------------------------

    const renderer = graphRef.renderer && graphRef.renderer();
    if (renderer) {
        renderer.useLegacyLights = false;
    }

    const controls = graphRef.controls();
    if (controls) {
        controls.minDistance = 50;
        controls.maxDistance = 2000;
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
    }

    return graphRef;
}

export function animateGraph() {
    if (!graphRef || !stateRef) return;

    if (typeof document !== 'undefined' && document.hidden) {
        requestAnimationFrame(animateGraph);
        return;
    }

    const time = Date.now() * 0.0015;
    const elapsed = (performance.now() * 0.001) - CLOCK_START;
    const opacity = 0.45 + Math.sin(time) * 0.15;
    const scaleMod = 1.0 + Math.sin(time) * 0.05;

    const nodes = (stateRef.graphData && stateRef.graphData.nodes) ? stateRef.graphData.nodes : [];
    nodes.forEach(n => {
        if(n.haloSprite) {
             n.haloSprite.material.opacity = opacity;
             n.haloSprite.scale.set(60 * scaleMod, 60 * scaleMod, 1);
        }
    });

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
            const r = 900 * Math.pow(Math.random(), 0.65) + 120;
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
            const size = 1.2 + Math.pow(rand, 2.5) * 13.2;
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
            fragmentShader: STAR_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        const stars = new THREE.Points(geo, mat);
        group.add(stars);

        scene.add(group);
    }, 1000);
}

function createSpaceDust(color) {
    const particleCount = 180;
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
        vertexShader: buildStarVertexShader(),
        fragmentShader: STAR_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    points.name = 'dust-points';

    return points;
}

function nodeRenderer(node) {
    const cacheKey = `${node.avatar}|${node.id === stateRef.userId ? 'self' : 'other'}|${(node.name || '').charAt(0).toUpperCase()}`;
    if (!textureCache.has(cacheKey)) {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);

        const draw = (img = null) => {
            ctx.clearRect(0,0,size,size);

            if(img) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI);
                ctx.clip();
                ctx.drawImage(img, 0, 0, size, size);
                ctx.restore();
            } else {
                ctx.fillStyle = 'white';
                ctx.font = 'bold 240px "Orbitron", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((node.name || '').charAt(0).toUpperCase(), size/2, size/2);
            }

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
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(16, 16, 1);
    sprite.renderOrder = 10;

    node.dispose = () => {
        if(material) material.dispose();
        if(node.haloTexture) node.haloTexture.dispose();
        if(node.haloMaterial) node.haloMaterial.dispose();
    };

    const group = new THREE.Group();

    if (node.id === stateRef.userId) {
        const haloCanvas = document.createElement('canvas');
        haloCanvas.width = 64;
        haloCanvas.height = 64;
        const hCtx = haloCanvas.getContext('2d');

        const grad = hCtx.createRadialGradient(32,32,0,32,32,32);
        grad.addColorStop(0, 'rgba(139, 92, 246, 0.8)');
        grad.addColorStop(0.5, 'rgba(139, 92, 246, 0.3)');
        grad.addColorStop(1, 'rgba(139, 92, 246, 0)');

        hCtx.fillStyle = grad;
        hCtx.fillRect(0,0,64,64);

        const haloTex = new THREE.CanvasTexture(haloCanvas);
        const haloMat = new THREE.SpriteMaterial({
            map: haloTex,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        const haloSprite = new THREE.Sprite(haloMat);

        haloSprite.scale.set(50, 50, 1);
        haloSprite.renderOrder = 1;

        group.add(haloSprite);

        node.haloSprite = haloSprite;
        node.haloTexture = haloTex;
        node.haloMaterial = haloMat;
    }

    group.add(sprite);

    const nameSprite = new SpriteText(node.name);
    nameSprite.color = 'white';
    nameSprite.fontFace = '"Orbitron", "Noto Sans SC", sans-serif';
    nameSprite.textHeight = 2.5;
    nameSprite.backgroundColor = null;
    nameSprite.center.set(0.5, 1);
    nameSprite.position.y = -9;
    if (nameSprite.material) nameSprite.material.depthWrite = false;
    group.add(nameSprite);

    return group;
}

function linkRenderer(link) {
    const group = new THREE.Group();
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

    const sprite = new SpriteText(style ? style.label : link.type);
    sprite.fontFace = '"Fredoka", "Varela Round", sans-serif';
    sprite.color = style ? style.color : 'lightgrey';
    sprite.textHeight = 4.5;
    sprite.backgroundColor = 'rgba(0,0,0,0)';
    sprite.padding = 2;
    if(sprite.material) sprite.material.depthWrite = false;
    group.add(sprite);

    return group;
}

export function getGraph() {
    return graphRef;
}
