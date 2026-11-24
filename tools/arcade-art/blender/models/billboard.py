k = Kit('billboard', 135)
ST='#4a5470'
for sx in (-1,1):
    k.box(1.6,1.6,0.9,(sx*5.0,0.3,-0.6),'#9aa0ad'); k.box(0.45,0.45,10.6,(sx*5.0,0.3,0.3),ST)
    k.strut((sx*5.0,0.3,0.6),(sx*5.0,2.6,5.6),0.1,ST,seg=4); k.box(1.0,1.0,0.5,(sx*5.0,2.8,-0.3),'#9aa0ad')
for z in (4.6,7.6,10.5): k.box(10.4,0.25,0.25,(0,0.3,z),ST)
for j in range(5):
    xa=-5.0+j*2.0
    k.strut((xa,0.3,4.6),(xa+2.0,0.3,7.6),0.06,ST,seg=3) if j%2 else k.strut((xa,0.3,7.6),(xa+2.0,0.3,4.6),0.06,ST,seg=3)
k.box(14.4,0.5,7.4,(0,-0.15,4.2),'#20232b')
def pix(c,r):
    if (c-6)**2+(r-7.2)**2<=10.5: return '#ffffff' if (c-6.8)**2+(r-8)**2<6 else '#d5dbe6'
    if 5<=c<=6 and 1<=r<=3: return '#ff8a1f'
    if 4<=c<=7 and r==3: return '#ff8a1f'
    if 12<=c<=24 and r in (8,9) and (c-12)%5!=4: return '#ffd21f'
    if 12<=c<=24 and r in (4,5,6) and ((c-12)%5 in (0,3) or (r==6 and (c-12)%5<4)): return '#ff3da6'
    if r<1 or r>11: return '#35d0ff'
    return mix('#3a1f7a','#1f2a6b',c/26)
CW=14.0/27; CH=7.0/13
for c in range(27):
    for r in range(13):
        x=-7.0+c*CW; z=4.4+r*CH
        k.poly([(x,-0.42,z),(x+CW,-0.42,z),(x+CW,-0.42,z+CH),(x,-0.42,z+CH)],pix(c,r),glow=1)
for (bx,bz,sx,sz) in ((0,4.2,14.6,0.25),(0,11.45,14.6,0.25),(-7.2,4.2,0.25,7.5),(7.2,4.2,0.25,7.5)): k.box(sx,0.6,sz,(bx,-0.2,bz),'#ffd21f')
for j in range(5):
    x=-5.6+j*2.8
    k.strut((x,-0.3,11.7),(x,-1.3,12.4),0.05,ST,seg=3); k.box(0.7,0.4,0.25,(x,-1.4,12.3),'#2a3040',m=RX(0.6)); k.box(0.5,0.3,0.06,(x,-1.5,12.2),'#fff4c2',m=RX(0.6),glow=1)
k.box(11,1.0,0.1,(0,0.9,4.0),'#6f7a8c')
R = k.done()
