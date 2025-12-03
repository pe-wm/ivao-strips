import sqlite3
import csv
import os

def get_db_connection(db_file):
    """Establishes a connection to the SQLite database."""
    if not os.path.exists(db_file):
        print(f"Error: Database file '{db_file}' not found.")
        return None
    try:
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f"Error connecting to database: {e}")
        return None

def process_waypoints(conn, input_file, output_file):
    """Updates waypoints.txt with new IDs from the database."""
    print(f"Processing {input_file}...")
    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' not found.")
        return

    try:
        with open(input_file, 'r', encoding='utf-8') as f_in, \
             open(output_file, 'w', encoding='utf-8', newline='') as f_out:
            
            # We'll write manually to handle comments and custom format
            for line in f_in:
                line = line.strip()
                if not line or line.startswith('#'):
                    f_out.write(line + '\n')
                    continue

                parts = line.split(';')
                if len(parts) < 6:
                    # Malformed line, just write it back
                    f_out.write(line + '\n')
                    continue

                # #id;Ident;Collocated;Name;Latitude;Longitude;NavaidID
                # 211744;GEMAM;0;GEMAM;-16.32527778;-71.85944444;
                old_id = parts[0]
                ident = parts[1]
                collocated = parts[2]
                name = parts[3]
                lat_str = parts[4]
                lon_str = parts[5]
                navaid_id = parts[6] if len(parts) > 6 else ""

                try:
                    lat = float(lat_str)
                    lon = float(lon_str)
                except ValueError:
                    f_out.write(f"# Error parsing lat/lon for {name}\n")
                    f_out.write(line + '\n')
                    continue

                # Search by Name first
                cursor = conn.execute("SELECT * FROM Waypoints WHERE WaypointName = ?", (name,))
                rows = cursor.fetchall()

                found_id = None
                
                if not rows:
                     # Try searching by Ident if Name fails (though prompt says Name)
                     cursor = conn.execute("SELECT * FROM Waypoints WHERE WaypointIdentifier = ?", (ident,))
                     rows = cursor.fetchall()

                if len(rows) == 1:
                    found_id = rows[0]['WaypointID']
                elif len(rows) > 1:
                    # Disambiguate by Lat/Lon
                    best_match = None
                    min_dist = float('inf')
                    
                    for row in rows:
                        # Simple Euclidean distance approximation for small distances
                        # In a real geo app we'd use haversine, but this should suffice for matching
                        db_lat = row['Latitude']
                        db_lon = row['Longitude']
                        dist = (lat - db_lat)**2 + (lon - db_lon)**2
                        
                        # Threshold for "same location" - e.g. 0.01 degrees
                        if dist < 0.0001: 
                            if dist < min_dist:
                                min_dist = dist
                                best_match = row
                    
                    if best_match:
                        found_id = best_match['WaypointID']
                
                if found_id:
                    new_line = f"{found_id};{ident};{collocated};{name};{lat_str};{lon_str};{navaid_id}"
                    f_out.write(new_line + '\n')
                else:
                    f_out.write(f"# Waypoint {name} ({ident}) not found or ambiguous in DB\n")
                    f_out.write(line + '\n')

    except Exception as e:
        print(f"Error processing waypoints: {e}")

def process_airports(conn, input_file, output_file):
    """Updates airports.txt and returns a list of (NewID, ICAO) for runways."""
    print(f"Processing {input_file}...")
    airport_data = [] # List of dicts: {'id': new_id, 'icao': icao}

    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' not found.")
        return airport_data

    try:
        with open(input_file, 'r', encoding='utf-8') as f_in, \
             open(output_file, 'w', encoding='utf-8', newline='') as f_out:
            
            for line in f_in:
                line = line.strip()
                if not line or line.startswith('#'):
                    f_out.write(line + '\n')
                    continue

                parts = line.split(';')
                if len(parts) < 2:
                    f_out.write(line + '\n')
                    continue

                # #ID;ICAO
                # 14202;SPQU
                old_id = parts[0]
                icao = parts[1]

                cursor = conn.execute("SELECT * FROM Airports WHERE AirportIdentifier = ?", (icao,))
                row = cursor.fetchone()

                if row:
                    new_id = row['AirportID']
                    f_out.write(f"{new_id};{icao}\n")
                    airport_data.append({'id': new_id, 'icao': icao})
                else:
                    f_out.write(f"# Airport {icao} not found in DB\n")
                    f_out.write(line + '\n')
                    # Keep old ID for runways check? No, if airport not found, can't find runways usually.
                    # But let's keep track if needed.
    
    except Exception as e:
        print(f"Error processing airports: {e}")

    return airport_data

def process_runways(conn, airport_data, output_file):
    """Generates runways.new.txt based on updated airport IDs."""
    print(f"Generating {output_file}...")
    
    try:
        with open(output_file, 'w', encoding='utf-8', newline='') as f_out:
            f_out.write("#ID;AirportID;Ident\n")
            
            for airport in airport_data:
                airport_id = airport['id']
                icao = airport['icao']
                
                f_out.write(f"#{icao}\n")
                
                cursor = conn.execute("SELECT * FROM Runways WHERE AirportID = ?", (airport_id,))
                rows = cursor.fetchall()
                
                if rows:
                    for row in rows:
                        runway_id = row['RunwayID']
                        ident = row['RunwayIdentifier']
                        # Format: 35599;14202;10
                        f_out.write(f"{runway_id};{airport_id};{ident}\n")
                else:
                    f_out.write(f"# No runways found for {icao} (ID: {airport_id})\n")

    except Exception as e:
        print(f"Error processing runways: {e}")

def main():
    db_file = 'nd.db3'
    waypoints_in = 'waypoints.txt'
    waypoints_out = 'waypoints.new.txt'
    airports_in = 'airports.txt'
    airports_out = 'airports.new.txt'
    runways_out = 'runways.new.txt'

    conn = get_db_connection(db_file)
    if not conn:
        return

    process_waypoints(conn, waypoints_in, waypoints_out)
    airport_data = process_airports(conn, airports_in, airports_out)
    process_runways(conn, airport_data, runways_out)

    conn.close()
    print("Done.")

if __name__ == "__main__":
    main()
