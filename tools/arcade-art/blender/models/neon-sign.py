k = Kit('neon-sign', 137)
ST='#3b4252'
k.box(2.2,2.2,0.9,(0,0,-0.6),'#9aa0ad',top=0.85); k.cyl(0.3,6.0,(0,0,0.3),ST,seg=8)
k.box(6.4,0.5,3.8,(0,0,5.6),'#1a1c2c'); k.box(6.8,0.6,0.25,(0,0,5.4),'#ffd21f'); k.box(6.8,0.6,0.25,(0,0,9.35),'#ffd21f')
def neon(pts,c,closed=False,r=0.09): k.tube([(p[0],-0.36,p[1]) for p in pts],r,col=c,seg=4,closed=closed,glow=1)
neon([(-2.2+0.75*cos(i*pi/6),7.5+0.75*sin(i*pi/6)) for i in range(12)],'#ffffff',True)
neon([(-2.2,6.3),(-2.2,6.75)],'#ff8a1f'); neon([(-2.6,6.3),(-1.8,6.3)],'#ff8a1f')
neon([(-0.9,6.2),(-0.9,8.9),(0.5,8.4),(-0.9,7.9)],'#ff3da6')
st=[(2.0+ (0.95 if i%2==0 else 0.4)*cos(pi/2+i*pi/5),7.6+(0.95 if i%2==0 else 0.4)*sin(pi/2+i*pi/5)) for i in range(10)]
neon(st,'#35d0ff',True)
neon([(-2.9,5.95),(2.9,5.95)],'#5dff7a',r=0.06)
k.push(T(0,0,9.6))
ar=[(-2.6,0.3),(1.0,0.3),(1.0,-0.2),(2.6,0.75),(1.0,1.7),(1.0,1.2),(-2.6,1.2)]
k.prism(ar,0.4,col='#1a1c2c'); k.tube([(p[0],-0.3,p[1]) for p in ar],0.09,col='#ffd21f',seg=4,closed=True,glow=1)
for j in range(5): k.sph(0.16,(-2.2+j*0.75,-0.25,0.75),'#ff3d3d' if j%2 else '#ffffff',sub=1,glow=1)
k.pop()
k.strut((0,0.3,5.6),(0,1.6,3.0),0.07,ST,seg=4)
R = k.done()
