/**
 * Kasa — global water ripple overlay
 * Uses the exact same WebGL fragment shader as the LiquidNavbar water effect.
 * A transparent full-page canvas sits above everything (pointer-events:none).
 * Every tap on a button/a/.kasa-ripple fires a ripple at that position.
 * The canvas is only active while ripples are alive; otherwise idle.
 */

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`

const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uDpr;uniform float uTime;
uniform vec4 uRip[8];uniform float uDark;
float sdRB(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float waves(vec2 p){float w=0.;
  for(int i=0;i<8;i++){vec4 R=uRip[i];if(R.w>0.){float x=length(p-R.xy)-R.z*320.;w+=R.w*exp(-R.z*1.8)*sin(x*.3)*exp(-x*x/800.);}}
  return w;}
float H(vec2 p){return waves(p)*2.8;}
float caus(vec2 p,float t){vec2 q=p;float c=0.;for(int i=0;i<3;i++){q+=vec2(sin(q.y*1.1+t),cos(q.x*1.3-t*.7))*.6;c+=1./(1.+16.*abs(sin(q.x)*sin(q.y)));}return c/3.;}
void main(){
  vec2 p=vec2(gl_FragCoord.x,uRes.y*uDpr-gl_FragCoord.y)/uDpr;
  float h0=H(p);
  vec3 n=normalize(vec3(h0-H(p+vec2(1.,0.)),h0-H(p+vec2(0.,1.)),1.));
  vec3 V=vec3(0.,0.,1.);
  float spec=pow(max(dot(reflect(-normalize(vec3(-.45,-.8,.85)),n),V),0.),70.);
  float spec2=pow(max(dot(reflect(-normalize(vec3(.6,.75,.7)),n),V),0.),22.)*.3;
  float fres=clamp((1.-n.z)*4.,0.,1.);
  vec3 irid=.5+.5*cos(6.2831*(vec3(0.,.33,.67)+fres*.85+p.x*.002+uTime*.035));
  float cs=caus(p*.07,uTime*.9);
  float pa=clamp(fres*.5+spec*.9+spec2,0.,1.);
  float da=clamp(smoothstep(.6,1.,cs)*.28*fres+spec*.3,0.,1.);
  vec3 tint=mix(vec3(.80,.95,1.),vec3(.55,.82,1.),uDark);
  vec3 c=mix(tint,irid,.5*fres)*pa+vec3(1.)*da;
  float a=pa+da*(1.-pa);
  /* fade out per ripple based on oldest age */
  float maxAmp=0.;for(int i=0;i<8;i++){maxAmp=max(maxAmp,uRip[i].w);}
  gl_FragColor=vec4(c,a*maxAmp*.85);
}`

interface Rip { x: number; y: number; age: number; amp: number }

function initGL(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false })
  if (!gl) return null
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("Shader error:", gl.getShaderInfoLog(s))
      return null
    }
    return s
  }
  const vs = sh(gl.VERTEX_SHADER, VERT)
  const fs = sh(gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const p = gl.createProgram()
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null
  gl.useProgram(p)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(p, "a")
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const u: Record<string, WebGLUniformLocation | null> = {}
  for (const n of ["uRes","uDpr","uTime","uRip","uDark"]) u[n] = gl.getUniformLocation(p, n)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  return { gl, u }
}

let injected = false

export function initRipple() {
  if (injected || typeof window === "undefined") return
  injected = true

  /* ---- build full-page canvas ---- */
  const canvas = document.createElement("canvas")
  canvas.style.cssText = [
    "position:fixed","top:0","left:0","width:100%","height:100%",
    "pointer-events:none","z-index:99999",
  ].join(";")
  document.body.appendChild(canvas)

  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  let glc = initGL(canvas)
  const rips: Rip[] = []
  let raf = 0
  let time = 0
  let last = 0

  /* ---- size canvas to viewport ---- */
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width  = Math.round(window.innerWidth  * dpr)
    canvas.height = Math.round(window.innerHeight * dpr)
  }
  resize()
  window.addEventListener("resize", resize, { passive: true })

  /* ---- render loop ---- */
  const draw = () => {
    if (!glc) return
    const { gl, u } = glc
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = window.innerWidth, H = window.innerHeight
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.uniform2f(u.uRes, W, H)
    gl.uniform1f(u.uDpr, dpr)
    gl.uniform1f(u.uTime, time)
    gl.uniform1f(u.uDark, dark)
    const rdata = new Float32Array(32)
    rips.slice(-8).forEach((r, i) => rdata.set([r.x, r.y, r.age, r.amp], i * 4))
    gl.uniform4fv(u.uRip, rdata)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const loop = () => {
    if (raf) return
    last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1/30)
      last = now
      time += dt
      rips.forEach(r => { r.age += dt; r.amp = Math.max(0, r.amp - dt * 0.72) })
      // remove dead ripples
      while (rips.length && rips[0].amp <= 0) rips.shift()
      draw()
      if (rips.length > 0) raf = requestAnimationFrame(tick)
      else { raf = 0; gl_clear() }
    }
    raf = requestAnimationFrame(tick)
  }

  const gl_clear = () => {
    if (!glc) return
    const { gl } = glc
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /* ---- fire ripple on any button/a tap ---- */
  document.addEventListener("pointerdown", (e) => {
    if (reduce) return
    if (!glc) { glc = initGL(canvas) } // try recover after context loss
    const origin = e.target as Element
    const target =
      origin.closest("button:not(.nimbus-item):not([data-no-ripple])") ??
      origin.closest("a:not([data-no-ripple])") ??
      origin.closest(".kasa-ripple")
    if (!target) return
    rips.push({ x: e.clientX, y: e.clientY, age: 0, amp: 1.0 })
    loop()
  }, { passive: true })

  /* ---- handle WebGL context loss ---- */
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault()
    glc = null
    cancelAnimationFrame(raf)
    raf = 0
  })
  canvas.addEventListener("webglcontextrestored", () => {
    glc = initGL(canvas)
  })
}
