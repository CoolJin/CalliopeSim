
from PIL import Image

def remove_checkerboard(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    data = img.getdata()
    
    new_data = []
    for item in data:
        # Check if the pixel is grayscale and bright (checkerboard is usually white/grey)
        # We will keep the dark teal board and the golden rings
        r, g, b, a = item
        
        # The Calliope board is dark teal (e.g. 10, 40, 50)
        # Golden rings are yellow/brown (e.g. 200, 180, 50)
        # Checkerboard is white (255,255,255) and grey (204,204,204)
        
        # If it is very close to white or grey (colorless and bright)
        if r > 180 and g > 180 and b > 180 and abs(r-g) < 20 and abs(g-b) < 20:
            new_data.append((255, 255, 255, 0)) # transparent
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    img.save(output_path, "PNG")

remove_checkerboard("public/calliope_clean.png", "public/calliope_clean.png")

