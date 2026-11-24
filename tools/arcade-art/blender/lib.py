import bpy, bmesh, math, random, traceback
from math import sin, cos, pi, sqrt, atan2, radians
from mathutils import Vector, Matrix, noise
I4 = Matrix.Identity(4)
def hexc(h):
    if not isinstance(h, str): return tuple(h)
    h = h.lstrip('#'); return (int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255)
def mix(a, b, t):
    a = hexc(a); b = hexc(b); return tuple(a[i]+(b[i]-a[i])*t for i in range(3))
def RZ(a): return Matrix.Rotation(a,4,'Z')
def RX(a): return Matrix.Rotation(a,4,'X')
def RY(a): return Matrix.Rotation(a,4,'Y')
def T(x,y=0,z=0): return Matrix.Translation((x,y,z))
def S(x,y=None,z=None):
    if y is None: y = x; z = x
    return Matrix.Diagonal((x,y,z,1))
def fbm(p, sc=1.0, oct=3, seed=0.0):
    return noise.fractal(Vector(p)*sc + Vector((seed,seed*1.7,seed*0.3)), 1.0, 2.0, oct)

# material slots beyond base (0) and glow (1), carried in the second colour UV's v (bake.mjs):
# screen / led / ad faces are TEXTURED: their first UV set is a real UV (Kit.uvquad); glass keeps its colour
SLOT = {'screen':0.2,'led':0.4,'ad':0.6,'glass':0.8}

class Kit:
    def __init__(s, name, seed=7):
        s.name = name; s.bm = bmesh.new(); s.rnd = random.Random(seed)
        s.bm.loops.layers.uv.new('c0'); s.bm.loops.layers.uv.new('c1')
        s.xf = [Matrix.Identity(4)]
    def push(s, m): s.xf.append(s.xf[-1] @ m)
    def pop(s): s.xf.pop()
    def paint(s, faces, col, glow=0, jit=0, fj=0, smooth=False, slot=None):
        u0 = s.bm.loops.layers.uv['c0']; u1 = s.bm.loops.layers.uv['c1']; c = hexc(col)
        k0 = 1 + s.rnd.choice((-1,-.5,0,.5,1))*jit if jit else 1
        for f in faces:
            k = k0*(1 + s.rnd.choice((-1,-.5,0,.5,1))*fj) if fj else k0
            r = min(1,max(0,c[0]*k)); g = min(1,max(0,c[1]*k)); b = min(1,max(0,c[2]*k))
            for l in f.loops:
                l[u0].uv = (r,g); l[u1].uv = (b, SLOT[slot] if slot else (1.0 if glow else 0.0))
            f.smooth = smooth
        return faces
    def tint(s, faces, fn):
        for f in faces:
            f.normal_update(); c = fn(f.calc_center_median(), f.normal)
            if c is None: continue
            if isinstance(c, tuple) and len(c)==2 and isinstance(c[0], (str,tuple)): s.paint([f], c[0], glow=c[1], smooth=f.smooth)
            else: s.paint([f], c, smooth=f.smooth)
    def _fin(s, verts, m, col, kw):
        bev = kw.pop('bev', 0)
        bmesh.ops.transform(s.bm, matrix=s.xf[-1] @ m, verts=verts)
        verts = [v for v in verts if v.is_valid]
        if bev:
            es = list({e for v in verts for e in v.link_edges})
            r = bmesh.ops.bevel(s.bm, geom=es, offset=bev, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES')
            verts = [v for v in set(verts) | set(r['verts']) if v.is_valid]
        fs = list({f for v in verts for f in v.link_faces})
        return s.paint(fs, col, **kw)
    def box(s, sx, sy, sz, at=(0,0,0), col='#888888', rz=0, m=None, top=None, **kw):
        vs = bmesh.ops.create_cube(s.bm, size=1)['verts']
        if top is not None:
            tx, ty = top if isinstance(top,(tuple,list)) else (top,top)
            for v in vs:
                if v.co.z > 0: v.co.x *= tx; v.co.y *= ty
            if tx == 0 or ty == 0: bmesh.ops.remove_doubles(s.bm, verts=vs, dist=1e-7); vs = [v for v in vs if v.is_valid]
        return s._fin(vs, T(*at) @ RZ(rz) @ (m or I4) @ T(0,0,sz/2) @ S(sx,sy,sz), col, kw)
    def cyl(s, r, h, at=(0,0,0), col='#888888', seg=8, r2=None, m=None, rz=0, cap=True, **kw):
        r2 = r if r2 is None else r2
        vs = bmesh.ops.create_cone(s.bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r2, depth=h)['verts']
        return s._fin(vs, T(*at) @ RZ(rz) @ (m or I4) @ T(0,0,h/2), col, kw)
    def strut(s, a, b, r, col='#888888', seg=4, r2=None, cap=False, **kw):
        a = Vector(a); b = Vector(b); d = b-a
        q = Vector((0,0,1)).rotation_difference(d).to_matrix().to_4x4()
        return s.cyl(r, d.length, col=col, seg=seg, r2=r2, m=T(*a) @ q, cap=cap, **kw)
    def sph(s, r, at=(0,0,0), col='#888888', sub=2, sc=(1,1,1), m=None, **kw):
        vs = bmesh.ops.create_icosphere(s.bm, subdivisions=sub, radius=r)['verts']
        return s._fin(vs, T(*at) @ (m or I4) @ S(*sc), col, kw)
    def prism(s, pts, d, at=(0,0,0), col='#888888', rz=0, m=None, **kw):
        n = len(pts); a = [s.bm.verts.new((x,-d/2,z)) for x,z in pts]; b = [s.bm.verts.new((x,d/2,z)) for x,z in pts]
        fs = [s.bm.faces.new(a), s.bm.faces.new(b[::-1])]
        for i in range(n): fs.append(s.bm.faces.new((a[i],a[(i+1)%n],b[(i+1)%n],b[i])))
        bmesh.ops.recalc_face_normals(s.bm, faces=fs)
        return s._fin(a+b, T(*at) @ RZ(rz) @ (m or I4), col, kw)
    def slab(s, pts, z0, z1, at=(0,0,0), col='#888888', rz=0, m=None, **kw):
        n = len(pts); a = [s.bm.verts.new((x,y,z0)) for x,y in pts]; b = [s.bm.verts.new((x,y,z1)) for x,y in pts]
        fs = [s.bm.faces.new(a), s.bm.faces.new(b[::-1])]
        for i in range(n): fs.append(s.bm.faces.new((a[i],a[(i+1)%n],b[(i+1)%n],b[i])))
        bmesh.ops.recalc_face_normals(s.bm, faces=fs)
        return s._fin(a+b, T(*at) @ RZ(rz) @ (m or I4), col, kw)
    def lathe(s, prof, seg=12, at=(0,0,0), col='#888888', m=None, cols=None, **kw):
        rings = []; vs = []
        for r,z in prof:
            if r <= 1e-6: ring = [s.bm.verts.new((0,0,z))]
            else: ring = [s.bm.verts.new((r*cos(2*pi*i/seg), r*sin(2*pi*i/seg), z)) for i in range(seg)]
            rings.append(ring); vs += ring
        fs = []; bands = []
        for a,b in zip(rings, rings[1:]):
            bf = []
            for i in range(seg):
                j = (i+1)%seg
                if len(a)==1 and len(b)==1: continue
                if len(a)==1: bf.append(s.bm.faces.new((a[0], b[i], b[j])))
                elif len(b)==1: bf.append(s.bm.faces.new((a[i], a[j], b[0])))
                else: bf.append(s.bm.faces.new((a[i], a[j], b[j], b[i])))
            bands.append(bf); fs += bf
        if len(rings[0])>1: fs.append(s.bm.faces.new(rings[0][::-1]))
        if len(rings[-1])>1: fs.append(s.bm.faces.new(rings[-1]))
        bmesh.ops.recalc_face_normals(s.bm, faces=fs)
        out = s._fin(vs, T(*at) @ (m or I4), col, dict(kw))
        if cols:
            for i,bf in enumerate(bands):
                c = cols[i % len(cols)]
                if c: s.paint(bf, c, **kw)
        return out
    def tube(s, pts, r, col='#888888', seg=6, cap=True, closed=False, **kw):
        pts = [Vector(p) for p in pts]; n = len(pts)
        rr = list(r) if isinstance(r,(list,tuple)) else [r]*n
        tang = []
        for i in range(n):
            a = pts[(i-1)%n] if closed else pts[max(i-1,0)]; b = pts[(i+1)%n] if closed else pts[min(i+1,n-1)]
            tang.append((b-a).normalized())
        up = Vector((0,0,1)) if abs(tang[0].z) < 0.9 else Vector((1,0,0))
        nrm = (up - tang[0]*up.dot(tang[0])).normalized()
        rings = []; vs = []
        for i in range(n):
            if i > 0:
                nrm = tang[i-1].rotation_difference(tang[i]) @ nrm
                nrm = (nrm - tang[i]*nrm.dot(tang[i])).normalized()
            bn = tang[i].cross(nrm)
            ring = [s.bm.verts.new(pts[i] + (nrm*cos(2*pi*j/seg) + bn*sin(2*pi*j/seg))*rr[i]) for j in range(seg)]
            rings.append(ring); vs += ring
        fs = []
        pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
        for a,b in pairs:
            for j in range(seg):
                k2 = (j+1)%seg; fs.append(s.bm.faces.new((a[j],a[k2],b[k2],b[j])))
        if cap and not closed:
            fs.append(s.bm.faces.new(rings[0][::-1])); fs.append(s.bm.faces.new(rings[-1]))
        bmesh.ops.recalc_face_normals(s.bm, faces=fs)
        return s._fin(vs, I4, col, kw)
    def poly(s, pts, col='#888888', **kw):
        vs = [s.bm.verts.new(p) for p in pts]; s.bm.faces.new(vs)
        return s._fin(vs, I4, col, kw)
    def sheet(s, fn, nu, nv, col='#888888', **kw):
        g = [[s.bm.verts.new(fn(i/nu, j/nv)) for j in range(nv+1)] for i in range(nu+1)]
        for i in range(nu):
            for j in range(nv): s.bm.faces.new((g[i][j],g[i+1][j],g[i+1][j+1],g[i][j+1]))
        return s._fin([v for row in g for v in row], I4, col, kw)
    def rock(s, r, at=(0,0,0), col='#888888', sub=2, sc=(1,1,1), amp=0.3, nsc=0.6, seed=None, m=None, **kw):
        seed = s.rnd.uniform(0,50) if seed is None else seed
        vs = bmesh.ops.create_icosphere(s.bm, subdivisions=sub, radius=1.0)['verts']
        for v in vs:
            d = v.co.normalized(); v.co = d*(1 + amp*fbm(d, nsc*2.0, 3, seed))
        kw.setdefault('fj', 0.08)
        return s._fin(vs, T(*at) @ (m or I4) @ S(r*sc[0], r*sc[1], r*sc[2]), col, kw)
    def rough(s, faces, amp, sc=1.0, seed=0.0, axis=None):
        s.bm.normal_update()
        for v in {v for f in faces for v in f.verts}:
            d = v.normal if axis is None else Vector(axis)
            v.co += d*amp*fbm(v.co, sc, 3, seed)
    def sub(s): return Kit(s.name+'_p', s.rnd.randint(0,99999))
    def add(s, k, mods=(), m=None, col=None, **kw):
        me = bpy.data.meshes.new('tmp'); k.bm.to_mesh(me); k.bm.free()
        if mods:
            ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
            for typ,a in mods:
                md = ob.modifiers.new(typ,typ)
                for x,y in a.items(): setattr(md,x,y)
            dg = bpy.context.evaluated_depsgraph_get()
            me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); me = me2
        me.transform(s.xf[-1] @ (m or I4))
        n0 = len(s.bm.faces)
        s.bm.from_mesh(me); bpy.data.meshes.remove(me)
        s.bm.faces.ensure_lookup_table()
        fs = [s.bm.faces[i] for i in range(n0, len(s.bm.faces))]
        if col is not None: s.paint(fs, col, **kw)
        return fs
    def skin(s, verts, edges, radii, col='#888888', sub=1, m=None, root=0, **kw):
        me = bpy.data.meshes.new('tmp'); me.from_pydata([tuple(v) for v in verts], edges, []); me.update()
        ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
        md = ob.modifiers.new('SKIN','SKIN')
        sv = me.skin_vertices[0].data
        for i,r in enumerate(radii):
            sv[i].radius = (r,r) if not isinstance(r,(tuple,list)) else r
            sv[i].use_root = (i == root)
        if sub: ob.modifiers.new('SUBSURF','SUBSURF').levels = sub
        dg = bpy.context.evaluated_depsgraph_get()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
        me2.transform(s.xf[-1] @ (m or I4))
        n0 = len(s.bm.faces); s.bm.from_mesh(me2); bpy.data.meshes.remove(me2)
        s.bm.faces.ensure_lookup_table()
        fs = [s.bm.faces[i] for i in range(n0, len(s.bm.faces))]
        return s.paint(fs, col, **kw)
    def tris(s): return sum(len(f.verts)-2 for f in s.bm.faces)
    def done(s, sharp=35):
        bm = s.bm
        fl = getattr(s,'floor',None)
        if fl is not None:
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:], dist=1e-5, plane_co=(0,0,fl), plane_no=(0,0,1), clear_inner=True)
        bm.normal_update()
        lim = radians(sharp)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim: e.smooth = False
        tris = s.tris()
        me = bpy.data.meshes.new(s.name); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(s.name, me); bpy.context.scene.collection.objects.link(ob)
        idx = len([o for o in bpy.data.objects if o.type == 'MESH']) - 1
        ob.location = ((idx % 6)*90.0, (idx//6)*90.0, 0)
        co = [v.co for v in me.vertices]
        mn = [round(min(c[i] for c in co),2) for i in range(3)]; mx = [round(max(c[i] for c in co),2) for i in range(3)]
        return {'tris': tris, 'min': mn, 'max': mx}

def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes): bpy.data.meshes.remove(me)

def run(SRC, keep=False):
    if not keep: reset()
    out = {}
    for name, src in SRC.items():
        t = bpy.data.texts.get('m_'+name) or bpy.data.texts.new('m_'+name)
        t.clear(); t.write(src)
        try:
            o = bpy.data.objects.get(name)
            if o: bpy.data.objects.remove(o, do_unlink=True)
            ns = dict(globals()); exec(src, ns); out[name] = ns.get('R')
        except Exception:
            out[name] = 'ERR ' + traceback.format_exc()[-700:]
    for o in list(bpy.data.objects):
        if o.name.startswith('tmp'): bpy.data.objects.remove(o, do_unlink=True)
    return out

SHIRTS = ['#e8372c','#ff8a1f','#ffd21f','#2fbf4a','#19c2b8','#2f7fe8','#8e4de0','#ff5fa8','#f4f4ee','#e8372c','#2f7fe8']
SKIN = ['#f2c9a0','#e0ac7e','#b9794c','#7a4c2e']
HAIR = ['#2a2018','#5a3a1e','#d8b25a','#1b1b1f','#8a2f1c','#e8e8e8']
PANTS = ['#2b3350','#3b3b3b','#5a4632','#dcdcdc','#28507a']
def person(k, x, y, z, mode='stand', arms=False, shirt=None, s=1.0):
    r = k.rnd; shirt = shirt or r.choice(SHIRTS); skin = r.choice(SKIN); hair = r.choice(HAIR)
    if mode == 'stand':
        k.box(0.36*s, 0.22*s, 0.82*s, (x,y,z), r.choice(PANTS)); z += 0.82*s
    tz = 0.6*s
    k.box(0.46*s, 0.26*s, tz, (x,y,z), shirt, top=(0.8,0.9))
    hz = z + tz + 0.13*s
    fs = k.sph(0.15*s, (x,y,hz), skin, sub=1)
    k.tint(fs, lambda c,n: hair if (c.z > hz + 0.03*s or c.y > y + 0.06*s) else None)
    if arms:
        for sx in (-1,1):
            a = (x+sx*0.24*s, y, z+tz*0.9)
            b = (x+sx*(0.3+r.random()*0.3)*s, y-0.06*s, z+tz+(0.3+r.random()*0.25)*s)
            k.strut(a, b, 0.06*s, shirt, seg=3)

def hull(k, L, W, D, col, deck=None, stripe=None, nu=10, nv=6):
    # a boat hull: bow to -Y, keel bottom at z=0, gunwale near z=D. returns (faces, sheer(u), halfwidth(u))
    def w(u): return max(0.03, (W/2)*min(1.0, (1-u)**0.6*1.35)*(0.78+0.22*min(1,u*3.5)))
    def sheer(u): return D*(1+0.22*(2*u-1)**2+0.12*u)
    def P(u,v):
        a = pi*v; s = sheer(u)
        return (-w(u)*cos(a), L/2-L*u, s-s*(max(0.0,sin(a))**0.7))
    fs = k.sheet(P, nu, nv, col)
    fs += k.poly([P(0,j/nv) for j in range(nv+1)], col)
    if stripe: k.tint(fs, lambda c,n: stripe if c.z > D*0.72 else None)
    if deck:
        k.sheet(lambda u,v: ((2*v-1)*w(u)*0.97, L/2-L*u, sheer(u)-0.22), nu, 1, deck)
    return fs, sheer, w
def flame(k, at, r=0.3, h=0.9):
    x,y,z = at
    k.cyl(r, h, (x,y,z), '#ff7a1a', seg=6, r2=0, glow=1)
    k.cyl(r*0.55, h*0.7, (x,y,z+h*0.05), '#ffe04a', seg=5, r2=0, glow=1, rz=0.5)

def wingrid(k, c, n, half, z0, fh, floors, bays, lit=0.5, cl=('#ffe9a0','#fff4c2','#8fe3ff'), cd='#1f3352', fw=0.72, fhh=0.62):
    nx,ny = n; tx,ty = -ny, nx
    bw = 2*half/bays
    for f in range(floors):
        for b in range(bays):
            u = -half+(b+0.5)*bw; z = z0+f*fh+fh*(1-fhh)/2
            a = u-bw*fw/2; e = u+bw*fw/2
            px = c[0]+nx*0.06; py = c[1]+ny*0.06
            P = [(px+tx*a,py+ty*a,z),(px+tx*e,py+ty*e,z),(px+tx*e,py+ty*e,z+fh*fhh),(px+tx*a,py+ty*a,z+fh*fhh)]
            if k.rnd.random() < lit: k.poly(P, k.rnd.choice(cl), glow=1)
            else: k.poly(P, cd)
def boxwin(k, cx, cy, sx, sy, z0, z1, floors, bx, by, **kw):
    fh = (z1-z0)/floors
    wingrid(k,(cx,cy-sy/2),(0,-1),sx/2,z0,fh,floors,bx,**kw); wingrid(k,(cx,cy+sy/2),(0,1),sx/2,z0,fh,floors,bx,**kw)
    wingrid(k,(cx-sx/2,cy),(-1,0),sy/2,z0,fh,floors,by,**kw); wingrid(k,(cx+sx/2,cy),(1,0),sy/2,z0,fh,floors,by,**kw)

def falls(k, rockc, topc, fluid, glow, poolc, foamc, crack=None):
    k.cyl(17.5,1.7,(0,-1,-1.5),rockc[1],seg=14,r2=15.5,fj=0.08)
    def big(r,at,sc,ci,sub=3,amp=0.3):
        fs = k.rock(r,at,rockc[ci%len(rockc)],sub=sub,sc=sc,amp=amp,fj=0.1)
        def tf(c,n):
            if topc and n.z>0.7 and c.z>at[2]+r*sc[2]*0.35: return topc
            if crack and k.rnd.random()<0.06 and c.y<at[1]: return (crack,1)
            return None
        k.tint(fs,tf)
    big(9,(0,10.5,8),(1.6,0.8,1.3),0); big(9,(0,11.5,19),(1.7,0.8,1.3),1)
    for sx in (-1,1):
        big(7.5,(sx*9.5,5,6),(1.0,1.0,1.2),1); big(6.5,(sx*10.5,6.5,15),(1.0,0.9,1.3),2); big(5.5,(sx*9.8,8,23),(1.1,0.9,1.1),0)
        big(4.5,(sx*12.8,0,2.5),(1.1,1.1,0.9),2,2); big(3.0,(sx*7.8,-5.5,1.0),(1.2,1.0,0.8),0,2); big(3.6,(sx*6.0,8.5,26.3),(1.2,1.0,0.75),1,2)
        big(2.2,(sx*4.3,3.2,12+sx*3),(1.2,0.9,0.7),2,2)
    big(4.2,(0,11.5,26.6),(2.2,1.0,0.5),2,2)
    g = 1 if glow else 0
    def fl(c,n):
        i = int((c.x+20)*1.3)%len(fluid)
        return (fluid[(i+int(c.z*0.37))%len(fluid)], g)
    fs = k.sheet(lambda u,v:((-3+6*u)*(1+0.4*v), 7.4-3.2*v**0.5-3.6*v, 28.0-27.6*v**1.25),8,12,fluid[0])
    k.tint(fs,fl)
    fs = k.sheet(lambda u,v:(-3+6*u, 7.4+6*v, 28.0+0.25*v),4,2,fluid[1]); k.tint(fs,fl)
    for sx in (-1,1):
        fs = k.sheet(lambda u,v:(sx*(5.6+1.4*u)+sx*1.2*v, 5.4-2.0*v**0.6-2.4*v, 20.5-20.0*v**1.3),2,8,fluid[1]); k.tint(fs,fl)
    k.lathe([(11.5,0.3),(11.5,0.42),(0,0.42)],16,col=poolc,m=T(0,-4.5,0)@S(1,0.8,1),glow=g,fj=0.05)
    k.lathe([(6.5,0.46),(0,0.46)],12,col=foamc,m=T(0,-2.2,0)@S(1,0.6,1),glow=g)
    for i in range(9):
        a = pi+pi*i/8
        k.rock(1.1+k.rnd.random()*0.9,(5.2*cos(a)*1.0,-0.6+2.6*sin(a),0.5),foamc,sub=1,sc=(1.2,1,0.55),glow=g,fj=0.04)
    for i in range(6):
        a = pi*1.05+pi*0.9*i/5
        k.rock(1.2+k.rnd.random()*1.2,(11.2*cos(a),-4.5+9.0*sin(a),0.2),rockc[i%len(rockc)],sub=1,sc=(1.2,1,0.8))

def skirtcone(k, R, z0, r1, z1, n, col, droop=0.25, jag=0.07, **kw):
    return k.sheet(lambda u,v:((R+(r1-R)*v)*(1+jag*(1-v)*sin(u*n*pi))*cos(2*pi*u),(R+(r1-R)*v)*(1+jag*(1-v)*sin(u*n*pi))*sin(2*pi*u),z0+(z1-z0)*v-droop*(1-v)*abs(sin(u*n*pi))),n*2,2,col,**kw)
def hexcrystal(k, at, r, h, col, tilt=(0,0), tip=None, **kw):
    m = T(*at) @ RX(tilt[0]) @ RY(tilt[1])
    k.lathe([(r*0.8,0),(r,h*0.25),(r*0.85,h*0.8),(0,h)],6,col=col,m=m,cols=[col,col,tip or col],**kw)
