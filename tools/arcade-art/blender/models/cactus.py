k = Kit('cactus', 115)
GR='#3f9a45'; GR2='#2f8238'
k.cyl(1.6,0.5,(0,0,-0.35),'#d9b56a',seg=9,r2=1.2)
def rib(fs,cx,cy):
    k.tint(fs, lambda c,n: GR2 if int((atan2(c.y-cy,c.x-cx)+pi)/(2*pi)*10+0.5)%2 else None)
fs=k.tube([(0,0,-0.1),(0,0,2.5),(0.05,0,4.6),(0,0,5.5)],[0.6,0.62,0.56,0.3],col=GR,seg=10,smooth=True); rib(fs,0,0)
k.sph(0.5,(0,0,5.45),GR,sub=1,sc=(1,1,0.9))
for (sx,z0,ln,up) in ((1,2.2,1.3,2.2),(-1,3.0,1.1,1.5),(1,3.8,0.0,0.0)):
    if ln==0: continue
    fs=k.tube([(sx*0.4,0,z0),(sx*(0.5+ln),0,z0+0.15),(sx*(0.75+ln),0,z0+0.9),(sx*(0.75+ln),0,z0+up)],[0.36,0.38,0.36,0.24],col=GR,seg=8,smooth=True)
    k.sph(0.3,(sx*(0.75+ln),0,z0+up),GR,sub=1); k.cyl(0.2,0.25,(sx*(0.75+ln),0,z0+up+0.22),'#ff5fa8',seg=6,r2=0.34); k.sph(0.12,(sx*(0.75+ln),0,z0+up+0.45),'#ffd21f',sub=1)
k.cyl(0.26,0.3,(0,0,5.85),'#ff5fa8',seg=6,r2=0.42); k.sph(0.15,(0,0,6.1),'#ffd21f',sub=1)
for (x,y,r) in ((1.2,-0.7,0.4),(-1.1,0.6,0.5),(0.3,1.2,0.35)): k.rock(r,(x,y,0.15),'#c9a55c',sub=1,sc=(1.2,1,0.7))
k.sph(0.45,(-1.2,-0.8,0.3),GR2,sub=1,sc=(1,1,0.8)); k.cyl(0.12,0.16,(-1.2,-0.8,0.62),'#ffd21f',seg=5,r2=0.2)
R = k.done()
