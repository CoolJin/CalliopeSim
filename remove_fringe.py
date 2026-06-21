
from PIL import Image

def remove_fringe(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    data = img.getdata()
    
    new_data = []
    for item in data:
        r, g, b, a = item
        
        # We want to remove the white/grey anti-aliasing fringe around the edges.
        # The board is dark teal (r<50, g<100, b<100 roughly).
        # The gold rings are yellow (r>150, g>120, b<120).
        # The fringe is white/grey (r>120, g>120, b>120, and r~g~b).
        
        if a > 0:
            # If it is greyish/whiteish (color channels are similar and high)
            if r > 100 and g > 100 and b > 100 and abs(r-g) < 30 and abs(g-b) < 30:
                # Make it transparent
                new_data.append((255, 255, 255, 0))
                continue
        new_data.append(item)
            
    img.putdata(new_data)
    img.save(output_path, "PNG")

remove_fringe("public/calliope_clean.png", "public/calliope_clean.png")

