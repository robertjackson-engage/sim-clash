k = Kit('skyscraper-3', 79)
W1='#5b46a8'; W2='#4a3990'; TR='#c9ccd4'
k.box(46,30,2.2,(0,0,-1.6),'#3a3f4a'); k.box(42,26,6.0,(0,0,0.6),'#2a2d44')
k.box(16,3.0,0.6,(0,-13.6,5.4),'#ff3da6',glow=1)
CL=('#ff8ad1','#8fe3ff','#ffe9a0')
for (cx,h,col) in ((-11,110.0,W1),(11,88.0,W2)):
    k.box(15,21,h-6.6,(cx,0,6.6),col)
    boxwin(k,cx,0,15,21,8.0,h-2.0,int((h-10)/4.5),3,5,lit=0.5,cl=CL,cd='#1d1a3a')
    k.box(15.8,21.8,1.0,(cx,0,h-0.5),TR)
    for sy in (-1,1): k.box(15.4,0.5,h-6.6,(cx,sy*10.6,6.6),TR,top=(1,1)) if False else None
    for sx in (-1,1):
        k.box(0.6,0.6,h-6.6,(cx+sx*7.5,-10.5,6.6),'#35d0ff',glow=1)
for z in (38.0,70.0):
    k.box(8,6,4.2,(0,0,z),'#8fe3ff',glow=1); k.box(8.2,6.4,0.5,(0,0,z-0.5),TR); k.box(8.2,6.4,0.5,(0,0,z+4.2),TR)
    for sx in (-1,1): k.strut((sx*3.5,0,z-0.4),(sx*3.5+sx*0.0,0,z-5.5),0.25,TR,seg=4)
BX=-11; BZ=74.0
k.box(13,0.8,22,(BX,-10.9,BZ),'#14122a')
def pix(c,r):
    d=(c-5.5)**2+(r-12.5)**2
    if d<12: return '#ffffff' if (c-6.2)**2+(r-13.2)**2<6 else '#d8dcf0'
    if 4<=c<=7 and 5<=r<=8: return '#ff8a1f' if r>6 else '#ffd21f'
    if c in (5,6) and 1<=r<=4: return '#ffd21f'
    if (c+r)%7==0: return '#ff3da6'
    return '#3a1f7a'
for c in range(12):
    for r in range(20):
        x=BX-6+c*1.0; z=BZ+1+r*1.0
        k.poly([(x+0.06,-11.32,z+0.06),(x+0.94,-11.32,z+0.06),(x+0.94,-11.32,z+0.94),(x+0.06,-11.32,z+0.94)],pix(c,r),glow=1)
k.cyl(6.0,0.4,(11,0,88.5),'#56607a',seg=12); k.cyl(4.6,0.1,(11,0,88.9),'#ffd21f',seg=12,glow=1); k.box(3.0,0.6,0.12,(11,0,88.95),'#f4f4ee'); k.box(0.6,3.0,0.12,(11,0,88.95),'#f4f4ee')
k.strut((-11,0,110),(-11,0,124),0.35,'#f4f4ee',seg=5,r2=0.1,cap=True)
for z in (114,119,124): k.sph(0.7,(-11,0,z),'#ff3d3d',sub=1,glow=1)
k.box(5,5,3.5,(-13,4,110.5),'#3a3560'); k.box(4,6,2.5,(8,-4,89),'#3a3560') if False else None
R = k.done()
