"""Иконка «Санитарный разрыв»: цыплёнок в стрелке цикла (заселение → освобождение → санразрыв), фирменные цвета aitas ukpf."""
from PIL import Image, ImageDraw
import math, os
BG=(229,219,192,255); INK=(34,30,26,255); ACC=(224,89,42,255)
def icon(n, pad=0.0):
  S=n*4; im=Image.new('RGBA',(S,S),BG); d=ImageDraw.Draw(im); c=S/2; k=1-pad
  lw=int(S*0.042*k); R=S*0.37*k
  a0,a1=-50,235                      # дуга цикла по часовой
  d.arc([c-R,c-R,c+R,c+R],start=a0,end=a1,fill=INK,width=lw)
  # наконечник стрелки по касательной в конце дуги
  a=math.radians(a1); ex,ey=c+(R-lw/2)*math.cos(a), c+(R-lw/2)*math.sin(a)
  tx,ty=-math.sin(a),math.cos(a); nx,ny=math.cos(a),math.sin(a)
  h=S*0.10*k; w=S*0.06*k
  d.polygon([(ex+tx*h,ey+ty*h),(ex+nx*w,ey+ny*w),(ex-nx*w,ey-ny*w)],fill=INK)
  # отметки этапов на кольце; одна — оранжевая (сегодня)
  for ang,acc in ((10,False),(95,False),(175,True)):
    r=math.radians(ang); x,y=c+(R-lw/2)*math.cos(r), c+(R-lw/2)*math.sin(r); rr=S*0.042*k
    d.ellipse([x-rr,y-rr,x+rr,y+rr],fill=ACC if acc else BG,outline=INK,width=int(lw*0.55))
  # цыплёнок
  bw=S*0.165*k; bx=c-S*0.025*k; by=c+S*0.07*k; ow=int(lw*0.9)
  hr=S*0.088*k; hx=bx+bw*0.62; hy=by-bw*0.88
  d.ellipse([hx-hr,hy-hr,hx+hr,hy+hr],fill=BG,outline=INK,width=ow)
  d.ellipse([bx-bw,by-bw*0.82,bx+bw,by+bw*0.82],fill=BG,outline=INK,width=ow)
  d.ellipse([hx-hr+ow,hy-hr+ow,hx+hr-ow,hy+hr-ow],fill=BG)          # шея без шва
  d.polygon([(hx+hr*0.85,hy-hr*0.22),(hx+hr*1.8,hy+hr*0.12),(hx+hr*0.85,hy+hr*0.42)],fill=ACC)
  er=S*0.016*k; d.ellipse([hx+hr*0.25-er,hy-hr*0.2-er,hx+hr*0.25+er,hy-hr*0.2+er],fill=INK)
  d.chord([bx-bw*0.62,by-bw*0.42,bx+bw*0.28,by+bw*0.52],start=10,end=170,fill=INK)   # крыло
  for dx in (-0.28,0.22):
    x=bx+bw*dx; y0=by+bw*0.8; y1=y0+S*0.055*k; fw=int(lw*0.55)
    d.line([(x,y0),(x,y1)],fill=INK,width=fw); d.line([(x-S*0.028*k,y1),(x+S*0.028*k,y1)],fill=INK,width=fw)
  return im.resize((n,n),Image.LANCZOS)
if __name__=='__main__':
  here=os.path.dirname(os.path.abspath(__file__))
  icon(192).save(f'{here}/icon-192.png'); icon(512).save(f'{here}/icon-512.png'); icon(512,pad=0.2).save(f'{here}/icon-maskable-512.png')
  os.makedirs(f'{here}/android',exist_ok=True)
  for dn,px in dict(mdpi=48,hdpi=72,xhdpi=96,xxhdpi=144,xxxhdpi=192).items(): icon(px*2).resize((px,px),Image.LANCZOS).save(f'{here}/android/{dn}.png')
