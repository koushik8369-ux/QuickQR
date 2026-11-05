import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageConfig;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.awt.Color;
import java.awt.Desktop;
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Scanner;
import java.util.stream.Stream;

public class QuickQR {

    private static final Path HISTORY_FILE = Path.of("qr-history.csv");
    private static final String HISTORY_HEADER =
            "Serial Number,Generated Filename,Original Message,Generation Date and Time,QR Image Size";
    private static final DateTimeFormatter HISTORY_TIME_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final List<HistoryEntry> generationHistory = new ArrayList<>();
    private static long nextHistorySerialNumber = 1;
    private static boolean historyWritable = true;

    public static void main(String[] args) {
        loadGenerationHistory();
        displayWelcomeScreen();

        try (Scanner scanner = new Scanner(System.in, StandardCharsets.UTF_8)) {
            boolean running = true;
            while (running) {
                displayMenu();
                System.out.print("Select an option (1-4): ");

                if (!scanner.hasNextLine()) {
                    System.out.println("\nInput ended. Exiting QuickQR.");
                    break;
                }

                String choice = scanner.nextLine().trim();
                switch (choice) {
                    case "1" -> generateQrCode(scanner);
                    case "2" -> viewGeneratedQrCodes(scanner);
                    case "3" -> viewGenerationHistory();
                    case "4" -> {
                        System.out.println("Thank you for using QuickQR. Goodbye!");
                        running = false;
                    }
                    default -> System.out.println("Invalid option. Please enter 1, 2, 3, or 4.");
                }
            }
        }
    }

    private static void displayWelcomeScreen() {
        System.out.println("==============================================");
        System.out.println("   QUICKQR - TEXT TO QR CODE GENERATOR");
        System.out.println("==============================================");
        System.out.println("Welcome! Choose an option to get started.");
    }

    private static void displayMenu() {
        System.out.println();
        System.out.println("1. Generate QR Code");
        System.out.println("2. View Generated QR Codes");
        System.out.println("3. View QR Generation History");
        System.out.println("4. Exit");
    }

    private static void generateQrCode(Scanner scanner) {
        System.out.println("Enter your message below. Type END on a separate line to finish.");
        StringBuilder messageBuilder = new StringBuilder();
        boolean firstLine = true;
        while (true) {
            if (!scanner.hasNextLine()) {
                System.out.println("\nInput ended. Returning to the main menu.");
                return;
            }

            String line = scanner.nextLine();
            if (line.equals("END")) {
                break;
            }
            if (!firstLine) {
                messageBuilder.append('\n');
            }
            messageBuilder.append(line);
            firstLine = false;
        }

        String message = messageBuilder.toString();
        if (message.isBlank()) {
            System.out.println("The message cannot be empty. Returning to the main menu.");
            return;
        }

        System.out.println("Complete message:");
        System.out.println(message);
        while (true) {
            System.out.print("Generate a QR code with this message? (Y/N): ");
            if (!scanner.hasNextLine()) {
                System.out.println("\nInput ended. Returning to the main menu.");
                return;
            }

            String confirmation = scanner.nextLine().trim();
            if (confirmation.equalsIgnoreCase("N")) {
                System.out.println("Generation cancelled. Returning to the main menu.");
                return;
            }
            if (confirmation.equalsIgnoreCase("Y")) {
                break;
            }
            System.out.println("Invalid response. Please enter Y or N.");
        }

        System.out.print("Enter a filename (leave blank for message): ");
        if (!scanner.hasNextLine()) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }

        String fileName = scanner.nextLine().trim();
        if (fileName.isEmpty()) {
            fileName = "message";
        }
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".png")) {
            fileName += ".png";
        }

        if (fileName.equals(".") || fileName.equals("..")
                || fileName.endsWith(" ")
                || fileName.chars().anyMatch(character ->
                character < 32 || "<>:\"/\\|?*".indexOf(character) >= 0)) {
            System.out.println("Invalid filename. Use a simple filename without reserved characters.");
            return;
        }

        String sizeChoice = promptSelection(scanner,
                "QR image size (200/300/400/500, Enter for 300): ",
                "300", "200", "300", "400", "500");
        if (sizeChoice == null) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }
        int imageSize = Integer.parseInt(sizeChoice);

        String correctionChoice = promptSelection(scanner,
                "Error correction level (L/M/Q/H, Enter for M): ",
                "M", "L", "M", "Q", "H");
        if (correctionChoice == null) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }
        ErrorCorrectionLevel errorCorrection = ErrorCorrectionLevel.valueOf(correctionChoice);

        String foregroundChoice = promptSelection(scanner,
                "Foreground color (Black/Blue/Red/Green, Enter for Black): ",
                "BLACK", "BLACK", "BLUE", "RED", "GREEN");
        if (foregroundChoice == null) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }
        Color foregroundColor = colorForName(foregroundChoice);

        String backgroundChoice;
        Color backgroundColor;
        while (true) {
            backgroundChoice = promptSelection(scanner,
                    "Background color (White/Yellow/Light blue, Enter for White): ",
                    "WHITE", "WHITE", "YELLOW", "LIGHT BLUE");
            if (backgroundChoice == null) {
                System.out.println("\nInput ended. Returning to the main menu.");
                return;
            }
            backgroundColor = colorForName(backgroundChoice);
            if (!foregroundColor.equals(backgroundColor)) {
                break;
            }
            System.out.println("Foreground and background colors must be different. Choose another background color.");
        }

        System.out.println("QR code settings preview:");
        System.out.println("  Image size: " + imageSize + " x " + imageSize);
        System.out.println("  Error correction: " + correctionChoice);
        System.out.println("  Foreground color: " + displayColorName(foregroundChoice));
        System.out.println("  Background color: " + displayColorName(backgroundChoice));

        try {
            Path outputDirectory = Path.of("generated-qr");
            Path outputFile = outputDirectory.resolve(fileName);
            if (Files.exists(outputFile)) {
                System.out.println("A file with that name already exists: "
                        + outputFile.toAbsolutePath().normalize());
                return;
            }

            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            // UTF-8 lets the QR code represent text beyond basic ASCII when supported.
            hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
            hints.put(EncodeHintType.ERROR_CORRECTION, errorCorrection);
            BitMatrix qrCode = new QRCodeWriter().encode(
                    message, BarcodeFormat.QR_CODE, imageSize, imageSize, hints);

            Files.createDirectories(outputDirectory);
            MatrixToImageConfig imageConfig = new MatrixToImageConfig(
                    foregroundColor.getRGB(), backgroundColor.getRGB());
            MatrixToImageWriter.writeToPath(qrCode, "PNG", outputFile, imageConfig);
            System.out.println("QR code generated successfully: "
                    + outputFile.toAbsolutePath().normalize());
            recordGeneration(fileName, message, imageSize);
        } catch (InvalidPathException exception) {
            System.out.println("Invalid filename: " + exception.getMessage());
        } catch (WriterException exception) {
            System.out.println("The message could not be encoded as a QR code (it may be too large): "
                    + exception.getMessage());
        } catch (IOException exception) {
            System.out.println("Unable to save the QR code: " + exception.getMessage());
        } catch (SecurityException exception) {
            System.out.println("Permission denied while saving the QR code: " + exception.getMessage());
        } catch (IllegalArgumentException exception) {
            System.out.println("Invalid QR code input: " + exception.getMessage());
        }
    }

    private static void loadGenerationHistory() {
        try {
            if (!Files.exists(HISTORY_FILE) || Files.size(HISTORY_FILE) == 0) {
                return;
            }

            List<List<String>> rows = parseCsv(Files.readString(HISTORY_FILE, StandardCharsets.UTF_8));
            if (rows.isEmpty() || !rows.get(0).equals(List.of(
                    "Serial Number", "Generated Filename", "Original Message",
                    "Generation Date and Time", "QR Image Size"))) {
                throw new IOException("The history file has an invalid header.");
            }

            for (int index = 1; index < rows.size(); index++) {
                List<String> row = rows.get(index);
                try {
                    if (row.size() != 5) {
                        throw new IllegalArgumentException("Expected 5 columns.");
                    }
                    long serialNumber = Long.parseLong(row.get(0));
                    int imageSize = Integer.parseInt(row.get(4));
                    if (serialNumber < 1 || imageSize < 1) {
                        throw new IllegalArgumentException("Serial number and image size must be positive.");
                    }

                    generationHistory.add(new HistoryEntry(
                            serialNumber, row.get(1), row.get(2), row.get(3), imageSize));
                    nextHistorySerialNumber = Math.max(nextHistorySerialNumber, serialNumber + 1);
                } catch (IllegalArgumentException exception) {
                    System.out.println("Skipping invalid QR history entry " + index + ": "
                            + exception.getMessage());
                }
            }
        } catch (IOException | SecurityException exception) {
            historyWritable = false;
            System.out.println("Unable to load QR generation history: " + exception.getMessage());
        }
    }

    private static List<List<String>> parseCsv(String csv) throws IOException {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean inQuotes = false;
        boolean afterQuote = false;
        boolean recordStarted = false;

        for (int index = 0; index < csv.length(); index++) {
            char character = csv.charAt(index);
            if (inQuotes) {
                if (character == '"') {
                    if (index + 1 < csv.length() && csv.charAt(index + 1) == '"') {
                        field.append('"');
                        index++;
                    } else {
                        inQuotes = false;
                        afterQuote = true;
                    }
                } else {
                    field.append(character);
                }
                continue;
            }

            if (afterQuote) {
                if (character == ',') {
                    row.add(field.toString());
                    field.setLength(0);
                    afterQuote = false;
                    recordStarted = true;
                } else if (character == '\n' || character == '\r') {
                    row.add(field.toString());
                    rows.add(row);
                    row = new ArrayList<>();
                    field.setLength(0);
                    afterQuote = false;
                    recordStarted = false;
                    if (character == '\r' && index + 1 < csv.length()
                            && csv.charAt(index + 1) == '\n') {
                        index++;
                    }
                } else {
                    throw new IOException("Unexpected character after a quoted CSV field.");
                }
                continue;
            }

            if (character == '"') {
                if (field.length() != 0) {
                    throw new IOException("Unexpected quote in an unquoted CSV field.");
                }
                inQuotes = true;
                recordStarted = true;
            } else if (character == ',') {
                row.add(field.toString());
                field.setLength(0);
                recordStarted = true;
            } else if (character == '\n' || character == '\r') {
                row.add(field.toString());
                rows.add(row);
                row = new ArrayList<>();
                field.setLength(0);
                recordStarted = false;
                if (character == '\r' && index + 1 < csv.length()
                        && csv.charAt(index + 1) == '\n') {
                    index++;
                }
            } else {
                field.append(character);
                recordStarted = true;
            }
        }

        if (inQuotes) {
            throw new IOException("The history file ends inside a quoted CSV field.");
        }
        if (recordStarted || afterQuote || !row.isEmpty() || field.length() > 0) {
            row.add(field.toString());
            rows.add(row);
        }
        return rows;
    }

    private static void recordGeneration(String fileName, String message, int imageSize) {
        if (!historyWritable) {
            System.out.println("QR code was generated, but history is unavailable because its file could not be loaded.");
            return;
        }

        HistoryEntry entry = new HistoryEntry(nextHistorySerialNumber, fileName, message,
                LocalDateTime.now().format(HISTORY_TIME_FORMAT), imageSize);
        try {
            boolean writeHeader = !Files.exists(HISTORY_FILE) || Files.size(HISTORY_FILE) == 0;
            try (BufferedWriter writer = Files.newBufferedWriter(
                    HISTORY_FILE, StandardCharsets.UTF_8, StandardOpenOption.CREATE,
                    StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
                if (writeHeader) {
                    writer.write(HISTORY_HEADER);
                    writer.newLine();
                }
                writer.write(toCsvRow(entry));
                writer.newLine();
            }
            generationHistory.add(entry);
            nextHistorySerialNumber++;
        } catch (IOException | SecurityException exception) {
            System.out.println("QR code was generated, but its history could not be saved: "
                    + exception.getMessage());
        }
    }

    private static String toCsvRow(HistoryEntry entry) {
        return entry.serialNumber() + ","
                + csvField(entry.fileName()) + ","
                + csvField(entry.message()) + ","
                + csvField(entry.generationTime()) + ","
                + entry.imageSize();
    }

    private static String csvField(String value) {
        if (value.indexOf(',') < 0 && value.indexOf('"') < 0
                && value.indexOf('\n') < 0 && value.indexOf('\r') < 0) {
            return value;
        }
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static void viewGenerationHistory() {
        if (generationHistory.isEmpty()) {
            System.out.println("No QR generation history found.");
            return;
        }

        System.out.println("QR generation history:");
        System.out.printf("%-8s | %-24s | %-19s | %-10s | %s%n",
                "Serial", "Filename", "Generated at", "Size", "Message");
        System.out.println("---------+--------------------------+---------------------+------------+--------");
        for (HistoryEntry entry : generationHistory) {
            String readableMessage = entry.message()
                    .replace("\r", "\\r")
                    .replace("\n", "\\n");
            System.out.printf("%-8d | %-24s | %-19s | %-10s | %s%n",
                    entry.serialNumber(), entry.fileName(), entry.generationTime(),
                    entry.imageSize() + " x " + entry.imageSize(), readableMessage);
        }
    }

    private record HistoryEntry(long serialNumber, String fileName, String message,
                                String generationTime, int imageSize) {
    }

    private static String promptSelection(Scanner scanner, String prompt,
                                          String defaultChoice, String... validChoices) {
        while (true) {
            System.out.print(prompt);
            if (!scanner.hasNextLine()) {
                return null;
            }

            String choice = scanner.nextLine().trim().toUpperCase(Locale.ROOT);
            if (choice.isEmpty()) {
                return defaultChoice;
            }
            for (String validChoice : validChoices) {
                if (choice.equals(validChoice)) {
                    return validChoice;
                }
            }
            System.out.println("Invalid choice. Please select one of the listed options.");
        }
    }

    private static Color colorForName(String colorName) {
        return switch (colorName) {
            case "BLACK" -> Color.BLACK;
            case "BLUE" -> Color.BLUE;
            case "RED" -> Color.RED;
            case "GREEN" -> Color.GREEN;
            case "WHITE" -> Color.WHITE;
            case "YELLOW" -> Color.YELLOW;
            case "LIGHT BLUE" -> new Color(173, 216, 230);
            default -> throw new IllegalArgumentException("Unsupported color: " + colorName);
        };
    }

    private static String displayColorName(String colorName) {
        return switch (colorName) {
            case "BLACK" -> "Black";
            case "BLUE" -> "Blue";
            case "RED" -> "Red";
            case "GREEN" -> "Green";
            case "WHITE" -> "White";
            case "YELLOW" -> "Yellow";
            case "LIGHT BLUE" -> "Light blue";
            default -> colorName;
        };
    }

    private static void viewGeneratedQrCodes(Scanner scanner) {
        Path outputDirectory = Path.of("generated-qr");
        try {
            if (!Files.isDirectory(outputDirectory)) {
                System.out.println("The generated-qr folder does not exist yet. Generate a QR code first.");
                return;
            }
        } catch (SecurityException exception) {
            System.out.println("Permission denied while accessing generated QR codes: "
                    + exception.getMessage());
            return;
        }

        List<Path> qrCodeFiles;
        try (Stream<Path> files = Files.list(outputDirectory)) {
            qrCodeFiles = files
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString()
                            .toLowerCase(Locale.ROOT).endsWith(".png"))
                    .sorted(Comparator.comparing(
                            path -> path.getFileName().toString(),
                            String.CASE_INSENSITIVE_ORDER))
                    .toList();

            if (qrCodeFiles.isEmpty()) {
                System.out.println("No generated QR code PNG files were found.");
                return;
            }

            System.out.println("Generated QR codes:");
            for (int index = 0; index < qrCodeFiles.size(); index++) {
                Path qrCodeFile = qrCodeFiles.get(index);
                double sizeInKilobytes = Files.size(qrCodeFile) / 1024.0;
                System.out.printf(Locale.ROOT, "%d. %s - %.2f KB%n",
                        index + 1, qrCodeFile.getFileName(), sizeInKilobytes);
            }
        } catch (IOException exception) {
            System.out.println("Unable to list generated QR codes: " + exception.getMessage());
            return;
        } catch (SecurityException exception) {
            System.out.println("Permission denied while listing generated QR codes: "
                    + exception.getMessage());
            return;
        }

        System.out.print("Select a QR code by serial number: ");
        if (!scanner.hasNextLine()) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }

        String selection = scanner.nextLine().trim();
        int serialNumber;
        try {
            serialNumber = Integer.parseInt(selection);
        } catch (NumberFormatException exception) {
            System.out.println("Invalid selection. Enter a listed serial number.");
            return;
        }

        if (serialNumber < 1 || serialNumber > qrCodeFiles.size()) {
            System.out.println("Invalid selection. Enter a listed serial number.");
            return;
        }

        Path selectedFile = qrCodeFiles.get(serialNumber - 1).toAbsolutePath().normalize();
        System.out.println("Selected QR code: " + selectedFile);
        System.out.print("Open this image with the default image viewer? (y/n): ");
        if (!scanner.hasNextLine()) {
            System.out.println("\nInput ended. Returning to the main menu.");
            return;
        }

        String openChoice = scanner.nextLine().trim();
        if (!openChoice.equalsIgnoreCase("y")) {
            if (!openChoice.equalsIgnoreCase("n")) {
                System.out.println("Invalid response. The image was not opened.");
            }
            return;
        }

        try {
            if (!Desktop.isDesktopSupported()) {
                System.out.println("Opening images is not supported on this system.");
                return;
            }

            Desktop desktop = Desktop.getDesktop();
            if (!desktop.isSupported(Desktop.Action.OPEN)) {
                System.out.println("Opening files is not supported on this system.");
                return;
            }

            desktop.open(selectedFile.toFile());
            System.out.println("Opened the selected QR code.");
        } catch (UnsupportedOperationException exception) {
            System.out.println("Opening images is not supported on this system.");
        } catch (IOException exception) {
            System.out.println("Unable to open the selected image: " + exception.getMessage());
        } catch (SecurityException exception) {
            System.out.println("Permission denied while opening the selected image: "
                    + exception.getMessage());
        } catch (IllegalArgumentException exception) {
            System.out.println("Unable to open the selected image: " + exception.getMessage());
        }
    }
}
