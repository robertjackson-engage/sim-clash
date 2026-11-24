k = Kit('boat', 31)
NAVY='#1f4f9a'; WHT='#f4f4ee'; RED='#d0342a'; DECK='#c98f52'; LIT='#ffe08a'; DK='#2b2f3a'; WOOD='#8a5530'; ORG='#ff8a1f'
L=9.6; DR=0.45
k.push(T(0,0,-DR))          # the waterline is z = 0: the keel hangs below it
fs,sheer,w = hull(k, L, 3.4, 1.6, NAVY, deck=DECK, nu=12, nv=8)
def hc(c, n):
    if n.y > 0.9: return None
    zr = (c.z+DR)/sheer(min(1.0,max(0.0,(L/2-c.y)/L)))
    return None if zr > 0.55 else (WHT if zr > 0.24 else '#a3241c')
k.tint(fs, hc)
for sx in (-1,1): k.tube([(sx*w(i/10),L/2-L*i/10,sheer(i/10)+0.02) for i in range(11)],0.07,col=WOOD,seg=4)
dz = sheer(0.5)-0.22
# ---- wheelhouse: lit windows, red roof, funnel, searchlight, radar, running lights
CY = -1.2
k.box(1.9,2.3,2.0,(0,CY,dz),WHT,bev=0.08); k.box(1.98,2.38,0.55,(0,CY,dz),NAVY)
for (x0,x1) in ((-0.8,-0.07),(0.07,0.8)): k.poly([(x0,CY-1.2,dz+0.95),(x1,CY-1.2,dz+0.95),(x1,CY-1.2,dz+1.72),(x0,CY-1.2,dz+1.72)],LIT,glow=1)
for sx in (-1,1):
    for (y0,y1) in ((CY-0.95,CY-0.08),(CY+0.08,CY+0.95)): k.poly([(sx*1.0,y0,dz+0.95),(sx*1.0,y1,dz+0.95),(sx*1.0,y1,dz+1.72),(sx*1.0,y0,dz+1.72)],LIT,glow=1)
    k.cyl(0.28,0.1,(sx*1.0,CY,dz+0.5),ORG,seg=8,m=RY(sx*pi/2)); k.cyl(0.13,0.13,(sx*1.0,CY,dz+0.5),WHT,seg=8,m=RY(sx*pi/2))
    k.box(0.14,0.22,0.14,(sx*1.12,CY-0.7,dz+2.14),'#ff3b30' if sx < 0 else '#3bff6a',glow=1)
k.poly([(-0.36,CY+1.2,dz+0.08),(-0.36,CY+1.2,dz+1.7),(0.36,CY+1.2,dz+1.7),(0.36,CY+1.2,dz+0.08)],WOOD)
k.cyl(0.16,0.06,(0,CY+1.19,dz+1.3),LIT,seg=8,m=RX(-pi/2),glow=1)
k.box(2.4,2.9,0.14,(0,CY-0.1,dz+2.0),RED,bev=0.04)
k.cyl(0.24,0.95,(0,CY+0.75,dz+2.14),RED,seg=8); k.cyl(0.27,0.24,(0,CY+0.75,dz+3.0),DK,seg=8)
k.box(0.3,0.3,0.3,(0.62,CY-1.0,dz+2.14),DK); k.box(0.24,0.1,0.24,(0.62,CY-1.19,dz+2.17),'#fff6c8',glow=1)
k.cyl(0.05,0.42,(-0.55,CY-0.5,dz+2.14),WHT,seg=4); k.box(1.1,0.16,0.1,(-0.55,CY-0.5,dz+2.56),WHT,rz=0.5)
# ---- mast, boom, stays dressed with pennants
k.cyl(0.08,5.6,(0,0.6,dz),WHT,seg=6); k.box(1.4,0.07,0.07,(0,0.6,dz+4.2),WHT); k.box(0.18,0.18,0.2,(0,0.6,dz+5.6),'#fff6c8',glow=1)
k.strut((0,0.6,dz+1.5),(0,3.9,dz+2.5),0.06,WOOD,seg=4); k.strut((0,0.6,dz+5.4),(0,3.9,dz+2.5),0.02,DK,seg=3)
top = Vector((0,0.6,dz+5.5)); bow = Vector((0,-4.75,sheer(1)+0.15)); stern = Vector((0,4.7,sheer(0)+0.45))
PC = ['#e8372c','#ffd21f','#2f7fe8','#2fbf4a','#ff5fa8','#f4f4ee']
for (a,b,n) in ((bow,top,9),(top,stern,6)):
    k.strut(a,b,0.02,'#e9e2c8',seg=3)
    for i in range(n):
        p = a+(b-a)*((i+0.3)/n); q = a+(b-a)*((i+0.8)/n); m = (p+q)/2
        k.poly([tuple(p),tuple(q),(m.x,m.y,m.z-0.5)],PC[i%6])
# ---- working deck: crates, a fish box on ice, a barrel, a heap of net and floats
k.box(0.7,0.7,0.6,(-0.6,2.0,dz),WOOD,jit=0.1,bev=0.03); k.box(0.6,0.8,0.45,(0.55,1.75,dz),'#2aa198')
k.box(0.8,0.55,0.35,(0.5,2.85,dz),'#3d7fd0'); k.box(0.7,0.45,0.08,(0.5,2.85,dz+0.33),'#eaf6ff')
k.cyl(0.3,0.75,(-0.75,3.05,dz),'#d9a03a',seg=8); k.cyl(0.315,0.1,(-0.75,3.05,dz+0.5),DK,seg=8)
k.rock(0.55,(-0.1,3.85,dz+0.12),'#2a8f86',sub=1,sc=(1.3,1.0,0.5),fj=0.14)
for (x,y) in ((-0.4,3.6),(0.2,4.05),(-0.2,4.2)): k.box(0.2,0.2,0.2,(x,y,dz+0.3),ORG)
k.box(0.5,0.5,0.9,(0,4.95,0.6),DK); k.box(0.56,0.5,0.42,(0,4.95,1.5),RED,bev=0.06)
k.strut((0,4.65,sheer(0)-0.1),(0,5.15,sheer(0)+1.45),0.035,WHT); k.poly([(0,5.15,sheer(0)+1.45),(0,6.1,sheer(0)+1.25),(0,5.15,sheer(0)+0.85)],RED)
for sx in (-1,1):
    for y in (-0.5,2.2):
        ww = w((L/2-y)/L)+0.03
        k.cyl(0.3,0.16,(sx*ww,y,dz-0.4),DK,seg=8,m=RY(sx*pi/2)); k.cyl(0.13,0.18,(sx*ww,y,dz-0.4),WHT,seg=8,m=RY(sx*pi/2))
k.box(0.2,0.2,0.26,(0,-4.35,sheer(0.95)+0.02),'#ffe9a0',glow=1); k.box(0.26,0.26,0.07,(0,-4.35,sheer(0.95)+0.28),DK)
k.cyl(0.09,0.3,(0.3,-3.9,dz),DK,seg=5)
person(k,0.45,2.35,dz,arms=True); person(k,-0.25,-3.3,dz,arms=False)
k.pop()
R = k.done()
